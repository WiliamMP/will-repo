// Pure functions that turn git's text output into structs.
// No process calls here, so everything is easy to test (see tests at the bottom).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Head,
    Branch,
    Remote,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub timestamp: i64,
    pub refs: Vec<RefLabel>,
    pub subject: String,
    /// Column in the graph, filled by `assign_lanes`
    pub lane: usize,
}

/// Field and record separators used in the `git log --format` string
pub const FS: char = '\u{1f}';
pub const RS: char = '\u{1e}';

/// Parses `git log --decorate=full --format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e`
pub fn parse_log(out: &str) -> Vec<Commit> {
    out.split(RS)
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .filter_map(|record| {
            let f: Vec<&str> = record.split(FS).collect();
            if f.len() < 6 {
                return None;
            }
            Some(Commit {
                hash: f[0].to_string(),
                parents: f[1].split_whitespace().map(String::from).collect(),
                author: f[2].to_string(),
                timestamp: f[3].parse().unwrap_or(0),
                refs: parse_decorations(f[4]),
                subject: f[5].to_string(),
                lane: 0,
            })
        })
        .collect()
}

/// "HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main"
pub fn parse_decorations(d: &str) -> Vec<RefLabel> {
    d.split(", ")
        .filter(|s| !s.is_empty())
        .filter_map(|s| {
            let (name, kind) = if let Some(b) = s.strip_prefix("HEAD -> refs/heads/") {
                (b, RefKind::Head)
            } else if s == "HEAD" {
                ("HEAD", RefKind::Head) // detached HEAD
            } else if let Some(t) = s.strip_prefix("tag: refs/tags/") {
                (t, RefKind::Tag)
            } else if let Some(b) = s.strip_prefix("refs/heads/") {
                (b, RefKind::Branch)
            } else if let Some(r) = s.strip_prefix("refs/remotes/") {
                if r.ends_with("/HEAD") {
                    return None; // origin/HEAD is just a pointer, skip it
                }
                (r, RefKind::Remote)
            } else {
                return None; // refs/stash and others
            };
            Some(RefLabel { name: name.to_string(), kind })
        })
        .collect()
}

/// Gives each commit a column so branches don't overlap.
/// `lanes[i]` holds the hash that column i is waiting for (the next parent to draw).
/// Commits must come children-before-parents (git log --date-order does that).
pub fn assign_lanes(commits: &mut [Commit]) {
    let mut lanes: Vec<Option<String>> = Vec::new();

    for c in commits.iter_mut() {
        let me = Some(c.hash.clone());
        let lane = match lanes.iter().position(|l| *l == me) {
            Some(i) => i,
            None => match lanes.iter().position(Option::is_none) {
                Some(i) => i,
                None => {
                    lanes.push(None);
                    lanes.len() - 1
                }
            },
        };
        // Every column that was waiting for this commit ends here
        for l in lanes.iter_mut() {
            if *l == me {
                *l = None;
            }
        }
        c.lane = lane;

        // First parent continues straight down in the same column
        let mut parents = c.parents.iter();
        lanes[lane] = parents.next().cloned();

        // Merge parents get their own column unless one already waits for them
        for p in parents {
            let p = Some(p.clone());
            if !lanes.contains(&p) {
                match lanes.iter().position(Option::is_none) {
                    Some(i) => lanes[i] = p,
                    None => lanes.push(p),
                }
            }
        }

        while lanes.last().is_some_and(Option::is_none) {
            lanes.pop();
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refs {
    pub head: Option<String>,
    pub branches: Vec<String>,
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
}

/// Parses `git for-each-ref --format=%(refname)%00%(HEAD)`
pub fn parse_refs(out: &str) -> Refs {
    let mut refs = Refs { head: None, branches: vec![], remotes: vec![], tags: vec![] };
    for line in out.lines() {
        let (name, head) = line.split_once('\0').unwrap_or((line, ""));
        if let Some(b) = name.strip_prefix("refs/heads/") {
            if head == "*" {
                refs.head = Some(b.to_string());
            }
            refs.branches.push(b.to_string());
        } else if let Some(r) = name.strip_prefix("refs/remotes/") {
            if !r.ends_with("/HEAD") {
                refs.remotes.push(r.to_string());
            }
        } else if let Some(t) = name.strip_prefix("refs/tags/") {
            refs.tags.push(t.to_string());
        }
    }
    refs
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// A, M, D, R, ... ; '?' = untracked
    pub status: char,
    pub add: u32,
    pub del: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
}

/// Parses `git status --porcelain=v1 -z`.
/// Each entry is "XY path\0"; renames add the old path as an extra "\0"-terminated field.
/// X = index (staged) state, Y = working tree (unstaged) state.
pub fn parse_status(out: &str) -> Status {
    let mut st = Status { staged: vec![], unstaged: vec![] };
    let mut entries = out.split('\0').filter(|e| !e.is_empty());
    while let Some(e) = entries.next() {
        let mut chars = e.chars();
        let (Some(x), Some(y)) = (chars.next(), chars.next()) else { continue };
        let path = e.get(3..).unwrap_or_default().to_string();
        if x == 'R' || x == 'C' {
            entries.next(); // skip the original path
        }
        let file = |status| FileChange { path: path.clone(), status, add: 0, del: 0 };
        if x == '?' {
            st.unstaged.push(file('?'));
            continue;
        }
        if x != ' ' {
            st.staged.push(file(x));
        }
        if y != ' ' {
            st.unstaged.push(file(y));
        }
    }
    st
}

/// Combines `--name-status` and `--numstat` output (both with --no-renames).
pub fn parse_changes(name_status: &str, numstat: &str) -> Vec<FileChange> {
    let mut files: Vec<FileChange> = name_status
        .lines()
        .filter_map(|l| {
            let (s, path) = l.split_once('\t')?;
            Some(FileChange { path: path.to_string(), status: s.chars().next()?, add: 0, del: 0 })
        })
        .collect();
    for l in numstat.lines() {
        let mut f = l.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (f.next(), f.next(), f.next()) else { continue };
        if let Some(file) = files.iter_mut().find(|x| x.path == path) {
            // binary files show "-" instead of numbers
            file.add = a.parse().unwrap_or(0);
            file.del = d.parse().unwrap_or(0);
        }
    }
    files
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffKind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffKind {
    Hunk,
    Ctx,
    Add,
    Del,
    Info,
}

/// Turns a unified diff into numbered lines. File headers before the first "@@" are skipped.
pub fn parse_diff(out: &str) -> Vec<DiffLine> {
    let mut lines = Vec::new();
    let (mut old, mut new) = (0u32, 0u32);
    let mut in_hunk = false;

    for l in out.lines() {
        if l.starts_with("@@") {
            // "@@ -12,7 +12,14 @@ fn x()": take the start numbers
            let num = |sign: char| -> u32 {
                l.split_whitespace()
                    .find_map(|p| p.strip_prefix(sign))
                    .and_then(|p| p.split(',').next())
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(1)
            };
            old = num('-');
            new = num('+');
            in_hunk = true;
            lines.push(DiffLine { kind: DiffKind::Hunk, old: None, new: None, text: l.to_string() });
        } else if !in_hunk {
            if l.starts_with("Binary files") {
                lines.push(DiffLine { kind: DiffKind::Info, old: None, new: None, text: "Arquivo binário".into() });
            }
        } else if let Some(t) = l.strip_prefix('+') {
            lines.push(DiffLine { kind: DiffKind::Add, old: None, new: Some(new), text: t.to_string() });
            new += 1;
        } else if let Some(t) = l.strip_prefix('-') {
            lines.push(DiffLine { kind: DiffKind::Del, old: Some(old), new: None, text: t.to_string() });
            old += 1;
        } else if l.starts_with('\\') {
            // "\ No newline at end of file"
        } else if l.starts_with("diff --git") {
            in_hunk = false;
        } else {
            let t = l.strip_prefix(' ').unwrap_or(l);
            lines.push(DiffLine { kind: DiffKind::Ctx, old: Some(old), new: Some(new), text: t.to_string() });
            old += 1;
            new += 1;
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(hash: &str, parents: &[&str]) -> Commit {
        Commit {
            hash: hash.into(),
            parents: parents.iter().map(|p| p.to_string()).collect(),
            author: String::new(),
            timestamp: 0,
            refs: vec![],
            subject: String::new(),
            lane: 0,
        }
    }

    #[test]
    fn log_record() {
        let out = format!("abc{FS}p1 p2{FS}Will{FS}1700000000{FS}HEAD -> refs/heads/main{FS}feat: x{RS}\n");
        let c = &parse_log(&out)[0];
        assert_eq!(c.hash, "abc");
        assert_eq!(c.parents, vec!["p1", "p2"]);
        assert_eq!(c.timestamp, 1_700_000_000);
        assert_eq!(c.subject, "feat: x");
        assert_eq!(c.refs[0], RefLabel { name: "main".into(), kind: RefKind::Head });
    }

    #[test]
    fn subject_with_separator_like_text() {
        let out = format!("a{FS}{FS}W{FS}1{FS}{FS}fix: a, b | c{RS}");
        assert_eq!(parse_log(&out)[0].subject, "fix: a, b | c");
        assert!(parse_log(&out)[0].parents.is_empty());
    }

    #[test]
    fn decorations() {
        let refs = parse_decorations(
            "HEAD -> refs/heads/main, tag: refs/tags/v1, refs/heads/feature/x, refs/remotes/origin/main, refs/remotes/origin/HEAD",
        );
        let kinds: Vec<_> = refs.iter().map(|r| (r.name.as_str(), r.kind)).collect();
        assert_eq!(
            kinds,
            vec![
                ("main", RefKind::Head),
                ("v1", RefKind::Tag),
                ("feature/x", RefKind::Branch),
                ("origin/main", RefKind::Remote),
            ]
        );
    }

    #[test]
    fn lanes_linear_history_stays_in_column_zero() {
        let mut c = vec![commit("c", &["b"]), commit("b", &["a"]), commit("a", &[])];
        assign_lanes(&mut c);
        assert!(c.iter().all(|c| c.lane == 0));
    }

    #[test]
    fn lanes_branch_and_merge() {
        // m merges f into b; f and b both come from a
        //   m      lane 0
        //   | f    lane 1
        //   b |    lane 0
        //   a      lane 0
        let mut c = vec![
            commit("m", &["b", "f"]),
            commit("f", &["a"]),
            commit("b", &["a"]),
            commit("a", &[]),
        ];
        assign_lanes(&mut c);
        let lanes: Vec<_> = c.iter().map(|c| c.lane).collect();
        assert_eq!(lanes, vec![0, 1, 0, 0]);
    }

    #[test]
    fn lanes_two_tips() {
        // two branch tips sharing a parent
        let mut c = vec![commit("x", &["a"]), commit("y", &["a"]), commit("a", &[])];
        assign_lanes(&mut c);
        let lanes: Vec<_> = c.iter().map(|c| c.lane).collect();
        assert_eq!(lanes, vec![0, 1, 0]);
    }

    #[test]
    fn refs_list() {
        let r = parse_refs("refs/heads/dev\0 \nrefs/heads/main\0*\nrefs/remotes/origin/HEAD\0 \nrefs/remotes/origin/main\0 \nrefs/tags/v1\0 \n");
        assert_eq!(r.head.as_deref(), Some("main"));
        assert_eq!(r.branches, vec!["dev", "main"]);
        assert_eq!(r.remotes, vec!["origin/main"]);
        assert_eq!(r.tags, vec!["v1"]);
    }

    #[test]
    fn status_entries() {
        let st = parse_status("M  staged.rs\0 M work.rs\0MM both.rs\0?? new.txt\0R  new.rs\0old.rs\0");
        let staged: Vec<_> = st.staged.iter().map(|f| (f.path.as_str(), f.status)).collect();
        let unstaged: Vec<_> = st.unstaged.iter().map(|f| (f.path.as_str(), f.status)).collect();
        assert_eq!(staged, vec![("staged.rs", 'M'), ("both.rs", 'M'), ("new.rs", 'R')]);
        assert_eq!(unstaged, vec![("work.rs", 'M'), ("both.rs", 'M'), ("new.txt", '?')]);
    }

    #[test]
    fn changes_with_numstat() {
        let files = parse_changes("M\tsrc/a.rs\nA\timg.png\n", "3\t1\tsrc/a.rs\n-\t-\timg.png\n");
        assert_eq!(files[0], FileChange { path: "src/a.rs".into(), status: 'M', add: 3, del: 1 });
        assert_eq!(files[1], FileChange { path: "img.png".into(), status: 'A', add: 0, del: 0 });
    }

    #[test]
    fn diff_numbers_lines() {
        let out = "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -10,3 +10,3 @@ fn f()\n ctx\n-old\n+new\n\\ No newline at end of file\n";
        let d = parse_diff(out);
        let rows: Vec<_> = d.iter().map(|l| (l.kind, l.old, l.new, l.text.as_str())).collect();
        assert_eq!(
            rows,
            vec![
                (DiffKind::Hunk, None, None, "@@ -10,3 +10,3 @@ fn f()"),
                (DiffKind::Ctx, Some(10), Some(10), "ctx"),
                (DiffKind::Del, Some(11), None, "old"),
                (DiffKind::Add, None, Some(11), "new"),
            ]
        );
    }

    #[test]
    fn diff_binary() {
        let d = parse_diff("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n");
        assert_eq!(d[0].kind, DiffKind::Info);
    }
}
