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
    /// a stash shown as its own node in the graph
    Stash,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    /// for the author's avatar
    pub email: String,
    pub timestamp: i64,
    pub refs: Vec<RefLabel>,
    pub subject: String,
    /// Column in the graph, filled by `assign_lanes`
    pub lane: usize,
    /// "stash@{0}" when this node is a stash, not a commit
    pub stash: Option<String>,
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
            if f.len() < 7 {
                return None;
            }
            Some(Commit {
                hash: f[0].to_string(),
                parents: f[1].split_whitespace().map(String::from).collect(),
                author: f[2].to_string(),
                email: f[3].to_string(),
                timestamp: f[4].parse().unwrap_or(0),
                refs: parse_decorations(f[5]),
                subject: f[6].to_string(),
                lane: 0,
                stash: None,
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
            Some(RefLabel {
                name: name.to_string(),
                kind,
            })
        })
        .collect()
}

/// Gives each commit a column so branches don't overlap.
/// `lanes[i]` holds the hash that column i is waiting for (the next parent to draw).
/// Commits must come children-before-parents (git log --date-order does that).
/// Parses `git stash list` with STASH_LOG_FORMAT into graph nodes.
/// A stash commit has 2-3 parents (base, index, untracked files); only the base is kept,
/// so the node hangs from the commit it was created on.
pub fn parse_stash_nodes(out: &str) -> Vec<Commit> {
    out.split(RS)
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .filter_map(|record| {
            let f: Vec<&str> = record.split(FS).collect();
            if f.len() < 7 {
                return None;
            }
            Some(Commit {
                hash: f[0].to_string(),
                parents: f[1].split_whitespace().take(1).map(String::from).collect(),
                author: f[2].to_string(),
                email: f[3].to_string(),
                timestamp: f[4].parse().unwrap_or(0),
                refs: vec![RefLabel { name: f[5].to_string(), kind: RefKind::Stash }],
                subject: f[6].to_string(),
                lane: 0,
                stash: Some(f[5].to_string()),
            })
        })
        .collect()
}

/// Puts each stash node above its base commit, at its place in time
pub fn insert_stashes(commits: &mut Vec<Commit>, stashes: Vec<Commit>) {
    // oldest first, so newer stashes of the same base end up on top
    for s in stashes.into_iter().rev() {
        let base = s.parents.first().and_then(|p| commits.iter().position(|c| &c.hash == p));
        let by_time = commits.iter().position(|c| c.timestamp < s.timestamp);
        let at = match (base, by_time) {
            (Some(b), Some(t)) => b.min(t),
            (Some(b), None) => b,
            (None, Some(t)) => t,
            (None, None) => commits.len(),
        };
        commits.insert(at, s);
    }
}

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
    let mut refs = Refs {
        head: None,
        branches: vec![],
        remotes: vec![],
        tags: vec![],
    };
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
    /// Files with merge conflicts (status 'U'), they are in neither list above
    pub conflicted: Vec<FileChange>,
}

/// Parses `git status --porcelain=v1 -z`.
/// Each entry is "XY path\0"; renames add the old path as an extra "\0"-terminated field.
/// X = index (staged) state, Y = working tree (unstaged) state.
pub fn parse_status(out: &str) -> Status {
    let mut st = Status {
        staged: vec![],
        unstaged: vec![],
        conflicted: vec![],
    };
    let mut entries = out.split('\0').filter(|e| !e.is_empty());
    while let Some(e) = entries.next() {
        let mut chars = e.chars();
        let (Some(x), Some(y)) = (chars.next(), chars.next()) else {
            continue;
        };
        let path = e.get(3..).unwrap_or_default().to_string();
        if x == 'R' || x == 'C' {
            entries.next(); // skip the original path
        }
        let file = |status| FileChange {
            path: path.clone(),
            status,
            add: 0,
            del: 0,
        };
        if x == '?' {
            st.unstaged.push(file('?'));
            continue;
        }
        // Unmerged pairs: both sides touched the file (UU, AA, DU, UD...)
        if matches!((x, y), ('D', 'D') | ('A', 'A') | ('U', _) | (_, 'U')) {
            st.conflicted.push(file('U'));
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
            Some(FileChange {
                path: path.to_string(),
                status: s.chars().next()?,
                add: 0,
                del: 0,
            })
        })
        .collect();
    for l in numstat.lines() {
        let mut f = l.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
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
    // Conflict view (see parse_conflicts)
    Marker,
    Ours,
    Base,
    Theirs,
}

/// Turns a unified diff into numbered lines. File headers before the first "@@" are skipped.
pub fn parse_diff(out: &str) -> Vec<DiffLine> {
    let mut lines = Vec::new();
    let (mut old, mut new) = (0u32, 0u32);
    let mut in_hunk = false;

    for l in out.lines() {
        if l.starts_with("@@") {
            old = hunk_start(l, '-');
            new = hunk_start(l, '+');
            in_hunk = true;
            lines.push(DiffLine {
                kind: DiffKind::Hunk,
                old: None,
                new: None,
                text: l.to_string(),
            });
        } else if !in_hunk {
            if l.starts_with("Binary files") {
                lines.push(DiffLine {
                    kind: DiffKind::Info,
                    old: None,
                    new: None,
                    text: "Arquivo binário".into(),
                });
            }
        } else if let Some(t) = l.strip_prefix('+') {
            lines.push(DiffLine {
                kind: DiffKind::Add,
                old: None,
                new: Some(new),
                text: t.to_string(),
            });
            new += 1;
        } else if let Some(t) = l.strip_prefix('-') {
            lines.push(DiffLine {
                kind: DiffKind::Del,
                old: Some(old),
                new: None,
                text: t.to_string(),
            });
            old += 1;
        } else if l.starts_with('\\') {
            // "\ No newline at end of file"
        } else if l.starts_with("diff --git") {
            in_hunk = false;
        } else {
            let t = l.strip_prefix(' ').unwrap_or(l);
            lines.push(DiffLine {
                kind: DiffKind::Ctx,
                old: Some(old),
                new: Some(new),
                text: t.to_string(),
            });
            old += 1;
            new += 1;
        }
    }
    lines
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    /// "stash@{0}", what git commands expect
    pub name: String,
    pub message: String,
    pub timestamp: i64,
}

/// Parses `git stash list --format=%gd%x1f%gs%x1f%ct`
pub fn parse_stash_list(out: &str) -> Vec<Stash> {
    out.lines()
        .filter_map(|l| {
            let mut f = l.split(FS);
            Some(Stash {
                name: f.next()?.to_string(),
                message: f.next()?.to_string(),
                timestamp: f.next()?.parse().unwrap_or(0),
            })
        })
        .collect()
}

/// From a multi-file diff, keeps only the section of one file
/// (`git stash show` has no pathspec, so we filter the full output).
pub fn file_section(diff: &str, file: &str) -> String {
    let start = format!("diff --git a/{file} b/{file}");
    let mut out = String::new();
    let mut inside = false;
    for l in diff.lines() {
        if l.starts_with("diff --git ") {
            inside = l == start;
        }
        if inside {
            out.push_str(l);
            out.push('\n');
        }
    }
    out
}

/// Builds a patch with only hunk number `index` (0-based) of a one-file diff:
/// file header + that hunk. `git apply` accepts it as a normal patch.
pub fn hunk_patch(diff: &str, index: usize) -> Option<String> {
    let (header, hunks) = split_hunks(diff);
    hunks.get(index).map(|h| header + h)
}

/// Splits a one-file diff into (file header, hunks). Each hunk starts with its "@@" line.
fn split_hunks(diff: &str) -> (String, Vec<String>) {
    let mut header = String::new();
    let mut hunks: Vec<String> = Vec::new();
    for l in diff.lines() {
        if l.starts_with("@@") {
            hunks.push(String::new());
        }
        let target = hunks.last_mut().unwrap_or(&mut header);
        target.push_str(l);
        target.push('\n');
    }
    (header, hunks)
}

/// Start line of one side in a hunk header: "@@ -12,7 +14,9 @@" -> 12 for '-', 14 for '+'
fn hunk_start(head: &str, sign: char) -> u32 {
    head.split_whitespace()
        .find_map(|p| p.strip_prefix(sign))
        .and_then(|p| p.split(',').next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(1)
}

/// One changed line inside a block of "-"/"+" lines
struct Change {
    line: String,
    picked: bool,
    /// "\ No newline at end of file" that follows this line, if any
    marker: Option<String>,
}

/// Like `hunk_patch`, but only the chosen lines of the hunk change.
/// `selected` = indexes of the hunk body lines (after "@@", not counting "\ No newline" lines),
/// the same numbering the UI gets from `parse_diff`.
/// `reverse` = the patch will be applied with --reverse (unstage/discard).
///
/// Unselected lines must become "no change":
/// - a line on the side that does not exist yet is dropped
/// - a line on the side that already exists turns into context
///
/// git writes each block of changes as all "-" lines, then all "+" lines.
/// Lines turned into context must keep their place in the file, so inside a block:
/// - forward: picked "-", picked "+", then old lines kept as context
/// - reverse: new lines kept as context, then picked "-", picked "+"
pub fn lines_patch(diff: &str, index: usize, selected: &[usize], reverse: bool) -> Option<String> {
    let (header, hunks) = split_hunks(diff);
    let mut lines = hunks.get(index)?.lines();
    let head = lines.next()?;

    let mut out: Vec<String> = Vec::new();
    let (mut dels, mut adds): (Vec<Change>, Vec<Change>) = (Vec::new(), Vec::new());
    let mut last_kind = ' ';
    let mut i = 0;

    for l in lines {
        if l.starts_with('\\') {
            // the marker belongs to the line right before it
            let target = match last_kind {
                '-' => dels.last_mut(),
                '+' => adds.last_mut(),
                _ => None,
            };
            match target {
                Some(c) => c.marker = Some(l.to_string()),
                None => out.push(l.to_string()),
            }
            continue;
        }
        let picked = selected.contains(&i);
        i += 1;
        last_kind = l.chars().next().unwrap_or(' ');
        let change = || Change {
            line: l.to_string(),
            picked,
            marker: None,
        };
        match last_kind {
            '-' => dels.push(change()),
            '+' => adds.push(change()),
            _ => {
                flush_block(&mut out, &mut dels, &mut adds, reverse);
                out.push(l.to_string());
            }
        }
    }
    flush_block(&mut out, &mut dels, &mut adds, reverse);

    if !out.iter().any(|l| l.starts_with('+') || l.starts_with('-')) {
        return None; // nothing selected in this hunk
    }
    let old_n = out
        .iter()
        .filter(|l| l.starts_with(' ') || l.starts_with('-'))
        .count();
    let new_n = out
        .iter()
        .filter(|l| l.starts_with(' ') || l.starts_with('+'))
        .count();
    let (old_start, new_start) = (hunk_start(head, '-'), hunk_start(head, '+'));
    let body: String = out.iter().map(|l| format!("{l}\n")).collect();
    Some(format!(
        "{header}@@ -{old_start},{old_n} +{new_start},{new_n} @@\n{body}"
    ))
}

fn flush_block(
    out: &mut Vec<String>,
    dels: &mut Vec<Change>,
    adds: &mut Vec<Change>,
    reverse: bool,
) {
    let mut emit = |c: &Change, as_context: bool| {
        out.push(if as_context {
            format!(" {}", &c.line[1..])
        } else {
            c.line.clone()
        });
        if let Some(m) = &c.marker {
            out.push(m.clone());
        }
    };
    if reverse {
        adds.iter()
            .filter(|c| !c.picked)
            .for_each(|c| emit(c, true));
    }
    dels.iter()
        .filter(|c| c.picked)
        .for_each(|c| emit(c, false));
    adds.iter()
        .filter(|c| c.picked)
        .for_each(|c| emit(c, false));
    if !reverse {
        dels.iter()
            .filter(|c| !c.picked)
            .for_each(|c| emit(c, true));
    }
    dels.clear();
    adds.clear();
}

// ---------- Conflicts ----------
//
// A file with conflicts looks like this (the "|||||||" part only with diff3 style):
//   <<<<<<< HEAD
//   our version
//   ||||||| base
//   common ancestor
//   =======
//   their version
//   >>>>>>> feature

#[derive(Clone, Copy, PartialEq)]
enum Section {
    Outside,
    Ours,
    Base,
    Theirs,
}

/// Where a conflict line belongs; `None` for a marker line that changes the section
fn next_section(line: &str, current: Section) -> Option<Section> {
    let l = line.trim_end_matches(['\r', '\n']);
    match current {
        Section::Outside if l.starts_with("<<<<<<<") => Some(Section::Ours),
        Section::Ours if l.starts_with("|||||||") => Some(Section::Base),
        Section::Ours | Section::Base if l == "=======" => Some(Section::Theirs),
        Section::Theirs if l.starts_with(">>>>>>>") => Some(Section::Outside),
        _ => None,
    }
}

/// File content with conflict markers -> lines for the conflict view.
/// `new` holds the line number in the file.
pub fn parse_conflicts(content: &str) -> Vec<DiffLine> {
    let mut section = Section::Outside;
    content
        .lines()
        .enumerate()
        .map(|(n, l)| {
            let kind = if let Some(next) = next_section(l, section) {
                section = next;
                DiffKind::Marker
            } else {
                match section {
                    Section::Outside => DiffKind::Ctx,
                    Section::Ours => DiffKind::Ours,
                    Section::Base => DiffKind::Base,
                    Section::Theirs => DiffKind::Theirs,
                }
            };
            DiffLine {
                kind,
                old: None,
                new: Some(n as u32 + 1),
                text: l.to_string(),
            }
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Choice {
    Ours,
    Theirs,
    /// ours followed by theirs
    Both,
}

/// Resolves conflict number `block` (0-based) keeping the chosen side.
/// Other conflicts are copied untouched. Line endings stay as they are
/// (split_inclusive keeps "\r\n"). Returns None when that block does not exist.
pub fn resolve_block(content: &str, block: usize, choice: Choice) -> Option<String> {
    let mut out = String::new();
    let (mut ours, mut theirs) = (String::new(), String::new());
    let mut section = Section::Outside;
    let mut current = 0;
    let mut found = false;

    for line in content.split_inclusive('\n') {
        let marker = next_section(line, section);
        let in_block = section != Section::Outside || marker.is_some();
        if !in_block || current != block {
            out.push_str(line);
        } else if marker.is_none() {
            match section {
                Section::Ours => ours.push_str(line),
                Section::Theirs => theirs.push_str(line),
                _ => {} // base lines and markers are dropped
            }
        }
        if let Some(next) = marker {
            if next == Section::Outside {
                if current == block {
                    found = true;
                    match choice {
                        Choice::Ours => out.push_str(&ours),
                        Choice::Theirs => out.push_str(&theirs),
                        Choice::Both => {
                            out.push_str(&ours);
                            out.push_str(&theirs);
                        }
                    }
                }
                current += 1;
            }
            section = next;
        }
    }
    found.then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(hash: &str, parents: &[&str]) -> Commit {
        Commit {
            hash: hash.into(),
            parents: parents.iter().map(|p| p.to_string()).collect(),
            author: String::new(),
            email: String::new(),
            timestamp: 0,
            refs: vec![],
            subject: String::new(),
            lane: 0,
            stash: None,
        }
    }

    #[test]
    fn log_record() {
        let out = format!(
            "abc{FS}p1 p2{FS}Will{FS}w@x{FS}1700000000{FS}HEAD -> refs/heads/main{FS}feat: x{RS}\n"
        );
        let c = &parse_log(&out)[0];
        assert_eq!(c.hash, "abc");
        assert_eq!(c.parents, vec!["p1", "p2"]);
        assert_eq!(c.timestamp, 1_700_000_000);
        assert_eq!(c.email, "w@x");
        assert_eq!(c.subject, "feat: x");
        assert_eq!(
            c.refs[0],
            RefLabel {
                name: "main".into(),
                kind: RefKind::Head
            }
        );
    }

    #[test]
    fn subject_with_separator_like_text() {
        let out = format!("a{FS}{FS}W{FS}w@x{FS}1{FS}{FS}fix: a, b | c{RS}");
        assert_eq!(parse_log(&out)[0].subject, "fix: a, b | c");
        assert!(parse_log(&out)[0].parents.is_empty());
    }

    #[test]
    fn stash_nodes_hang_from_their_base() {
        let out = format!("s1{FS}b i u{FS}W{FS}w@x{FS}150{FS}stash@{{0}}{FS}On main: wip{RS}");
        let stashes = parse_stash_nodes(&out);
        assert_eq!(stashes[0].parents, vec!["b"]);
        assert_eq!(stashes[0].stash.as_deref(), Some("stash@{0}"));
        assert_eq!(stashes[0].refs[0].kind, RefKind::Stash);

        let mut c = vec![commit("c", &["b"]), commit("b", &["a"]), commit("a", &[])];
        (c[0].timestamp, c[1].timestamp, c[2].timestamp) = (300, 100, 50);
        insert_stashes(&mut c, stashes);
        let order: Vec<_> = c.iter().map(|c| c.hash.as_str()).collect();
        // newer than b, older than c
        assert_eq!(order, vec!["c", "s1", "b", "a"]);
        assign_lanes(&mut c);
        assert_ne!(c[1].lane, c[0].lane); // its own column
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
        let st =
            parse_status("M  staged.rs\0 M work.rs\0MM both.rs\0?? new.txt\0R  new.rs\0old.rs\0");
        let staged: Vec<_> = st
            .staged
            .iter()
            .map(|f| (f.path.as_str(), f.status))
            .collect();
        let unstaged: Vec<_> = st
            .unstaged
            .iter()
            .map(|f| (f.path.as_str(), f.status))
            .collect();
        assert_eq!(
            staged,
            vec![("staged.rs", 'M'), ("both.rs", 'M'), ("new.rs", 'R')]
        );
        assert_eq!(
            unstaged,
            vec![("work.rs", 'M'), ("both.rs", 'M'), ("new.txt", '?')]
        );

        let st = parse_status("UU c.rs\0AA d.rs\0UD e.rs\0");
        assert_eq!(st.conflicted.len(), 3);
        assert!(st.staged.is_empty() && st.unstaged.is_empty());
    }

    #[test]
    fn changes_with_numstat() {
        let files = parse_changes(
            "M\tsrc/a.rs\nA\timg.png\n",
            "3\t1\tsrc/a.rs\n-\t-\timg.png\n",
        );
        assert_eq!(
            files[0],
            FileChange {
                path: "src/a.rs".into(),
                status: 'M',
                add: 3,
                del: 1
            }
        );
        assert_eq!(
            files[1],
            FileChange {
                path: "img.png".into(),
                status: 'A',
                add: 0,
                del: 0
            }
        );
    }

    #[test]
    fn diff_numbers_lines() {
        let out = "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -10,3 +10,3 @@ fn f()\n ctx\n-old\n+new\n\\ No newline at end of file\n";
        let d = parse_diff(out);
        let rows: Vec<_> = d
            .iter()
            .map(|l| (l.kind, l.old, l.new, l.text.as_str()))
            .collect();
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

    #[test]
    fn stash_list() {
        let s = parse_stash_list(&format!("stash@{{0}}{FS}On main: wip{FS}1700000000\n"));
        assert_eq!(
            s[0],
            Stash {
                name: "stash@{0}".into(),
                message: "On main: wip".into(),
                timestamp: 1_700_000_000
            }
        );
    }

    #[test]
    fn picks_one_file_from_diff() {
        let diff = "diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-a\n+A\ndiff --git a/b.txt b/b.txt\n@@ -1 +1 @@\n-b\n+B\n";
        let s = file_section(diff, "b.txt");
        assert_eq!(s, "diff --git a/b.txt b/b.txt\n@@ -1 +1 @@\n-b\n+B\n");
    }

    #[test]
    fn builds_patch_for_one_hunk() {
        let diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -10 +10 @@\n-j\n+J\n\\ No newline at end of file\n";
        let p = hunk_patch(diff, 1).unwrap();
        assert_eq!(p, "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10 +10 @@\n-j\n+J\n\\ No newline at end of file\n");
        assert!(hunk_patch(diff, 2).is_none());
    }

    const HUNK: &str =
        "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n+C\n c\n";

    #[test]
    fn lines_patch_stage_one_added_line() {
        // body indexes: 0 " a", 1 "-b", 2 "+B", 3 "+C", 4 " c"
        // unpicked "-b" stays as context after the picked "+B"; unpicked "+C" is dropped
        let p = lines_patch(HUNK, 0, &[2], false).unwrap();
        assert_eq!(
            p,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n a\n+B\n b\n c\n"
        );
    }

    #[test]
    fn lines_patch_reverse_keeps_existing_side_as_context() {
        // unstage only the removal of "b": the added lines already exist, so they become context
        let p = lines_patch(HUNK, 0, &[1], true).unwrap();
        assert_eq!(
            p,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,5 +1,4 @@\n a\n B\n C\n-b\n c\n"
        );
    }

    #[test]
    fn lines_patch_needs_a_changed_line() {
        assert!(lines_patch(HUNK, 0, &[0, 4], false).is_none());
        assert!(lines_patch(HUNK, 1, &[2], false).is_none());
    }

    const CONFLICT: &str = "top\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nmiddle\n<<<<<<< HEAD\nm2\n||||||| base\nb2\n=======\nt2\n>>>>>>> feature\nend\n";

    #[test]
    fn conflict_view_kinds() {
        let kinds: Vec<_> = parse_conflicts(CONFLICT).iter().map(|l| l.kind).collect();
        use DiffKind::*;
        assert_eq!(
            kinds,
            vec![
                Ctx, Marker, Ours, Marker, Theirs, Marker, Ctx, Marker, Ours, Marker, Base, Marker,
                Theirs, Marker, Ctx
            ]
        );
    }

    #[test]
    fn resolve_each_block() {
        let first = resolve_block(CONFLICT, 0, Choice::Theirs).unwrap();
        assert!(first.starts_with("top\ntheirs\nmiddle\n<<<<<<< HEAD\nm2\n||||||| base\nb2\n"));
        let both = resolve_block(&first, 0, Choice::Both).unwrap();
        assert_eq!(both, "top\ntheirs\nmiddle\nm2\nt2\nend\n");
        assert!(resolve_block(&both, 0, Choice::Ours).is_none());
    }

    #[test]
    fn resolve_keeps_crlf() {
        let crlf = CONFLICT.replace('\n', "\r\n");
        let out = resolve_block(&crlf, 0, Choice::Ours).unwrap();
        assert!(out.starts_with("top\r\nmine\r\nmiddle\r\n"));
    }
}
