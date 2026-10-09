// Tauri commands: each one runs the git CLI and returns parsed data to React.
// `#[tauri::command(async)]` runs the function on a worker thread,
// so a slow push doesn't freeze the window (like TThread in Delphi).

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use serde::{Deserialize, Serialize};

use crate::parse::{self, Choice, Commit, DiffLine, FileChange, Refs, Stash, Status, FS};

type Res<T> = Result<T, String>;

fn run(repo: &str, args: &[&str]) -> Res<Output> {
    run_with_input(repo, args, None)
}

/// Same as `run`, optionally writing `input` to git's stdin (used by `git apply -`)
fn run_with_input(repo: &str, args: &[&str], input: Option<&str>) -> Res<Output> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["-c", "core.quotePath=false", "-c", "color.ui=false"])
        .args(args)
        // never wait for a username/password on stdin; the Git Credential Manager window still works
        .env("GIT_TERMINAL_PROMPT", "0")
        // never open an editor (merge/rebase --continue would wait for it forever)
        .env("GIT_EDITOR", "true");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console flashing on every git call
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let fail = |e: std::io::Error| format!("Não foi possível executar o git: {e}");
    let Some(input) = input else {
        return cmd.output().map_err(fail);
    };

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(fail)?;
    // take() moves stdin out so it is closed (EOF) when this block ends
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .map_err(fail)?;
    child.wait_with_output().map_err(fail)
}

/// Runs git and returns stdout, or stderr as the error message
fn git(repo: &str, args: &[&str]) -> Res<String> {
    git_with_input(repo, args, None)
}

fn git_with_input(repo: &str, args: &[&str], input: Option<&str>) -> Res<String> {
    let out = run_with_input(repo, args, input)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let mut err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.is_empty() {
            // merge/rebase print conflicts on stdout
            err = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
        Err(if err.is_empty() {
            format!("git {} falhou", args.join(" "))
        } else {
            err
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    path: String,
    name: String,
}

#[tauri::command(async)]
pub fn open_repo(path: String) -> Res<RepoInfo> {
    let root = git(&path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| "Esta pasta não é um repositório git".to_string())?
        .trim()
        .to_string();
    let name = Path::new(&root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(RepoInfo { path: root, name })
}

// %x1f / %x1e = the FS / RS separators from parse.rs
const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e";

/// Newest `limit` commits of all branches. "Load more" asks again with a bigger limit:
/// lanes need the history from the top, so we don't page with --skip.
// ponytail: re-reads everything on "load more", fine for tens of thousands of commits
#[tauri::command(async)]
pub fn log(repo: String, limit: usize) -> Res<Vec<Commit>> {
    let n = limit.to_string();
    let out = git(
        &repo,
        &[
            "log",
            "--all",
            "--date-order",
            "--decorate=full",
            "-n",
            &n,
            LOG_FORMAT,
        ],
    )?;
    let mut commits = parse::parse_log(&out);
    parse::assign_lanes(&mut commits);
    Ok(commits)
}

#[tauri::command(async)]
pub fn refs(repo: String) -> Res<Refs> {
    let out = git(
        &repo,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(HEAD)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    Ok(parse::parse_refs(&out))
}

#[tauri::command(async)]
pub fn status(repo: String) -> Res<Status> {
    let out = git(
        &repo,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    Ok(parse::parse_status(&out))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracking {
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
}

#[tauri::command(async)]
pub fn tracking(repo: String) -> Res<Tracking> {
    let Ok(upstream) = git(&repo, &["rev-parse", "--abbrev-ref", "@{u}"]) else {
        return Ok(Tracking {
            upstream: None,
            ahead: 0,
            behind: 0,
        });
    };
    let counts = git(
        &repo,
        &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
    )?;
    let mut n = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
    Ok(Tracking {
        upstream: Some(upstream.trim().to_string()),
        ahead: n.next().unwrap_or(0),
        behind: n.next().unwrap_or(0),
    })
}

// Merge commits are compared against their first parent (what SourceTree shows by default)
const SHOW: [&str; 4] = [
    "show",
    "--format=",
    "--diff-merges=first-parent",
    "--no-renames",
];

#[tauri::command(async)]
pub fn commit_files(repo: String, hash: String) -> Res<Vec<FileChange>> {
    let names = git(&repo, &[&SHOW[..], &["--name-status", &hash]].concat())?;
    let nums = git(&repo, &[&SHOW[..], &["--numstat", &hash]].concat())?;
    Ok(parse::parse_changes(&names, &nums))
}

#[tauri::command(async)]
pub fn commit_diff(repo: String, hash: String, file: String) -> Res<Vec<DiffLine>> {
    let out = git(&repo, &[&SHOW[..], &[&hash, "--", &file]].concat())?;
    Ok(parse::parse_diff(&out))
}

/// Diff of an uncommitted file. `staged` picks index vs working tree.
#[tauri::command(async)]
pub fn working_diff(
    repo: String,
    file: String,
    staged: bool,
    untracked: bool,
) -> Res<Vec<DiffLine>> {
    let out = if untracked {
        // --no-index exits with 1 when files differ, which is the normal case here
        let out = run(&repo, &["diff", "--no-index", "--", "/dev/null", &file])?;
        String::from_utf8_lossy(&out.stdout).into_owned()
    } else if staged {
        git(&repo, &["diff", "--cached", "--no-renames", "--", &file])?
    } else {
        git(&repo, &["diff", "--no-renames", "--", &file])?
    };
    Ok(parse::parse_diff(&out))
}

#[tauri::command(async)]
pub fn stage(repo: String, files: Vec<String>) -> Res<()> {
    let args: Vec<&str> = ["add", "--"]
        .into_iter()
        .chain(files.iter().map(String::as_str))
        .collect();
    git(&repo, &args).map(drop)
}

#[tauri::command(async)]
pub fn unstage(repo: String, files: Vec<String>) -> Res<()> {
    let has_head = git(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok();
    // `restore --staged` needs a HEAD; in a repo without commits, remove from the index instead
    let base: &[&str] = if has_head {
        &["restore", "--staged", "--"]
    } else {
        &["rm", "--cached", "-q", "--"]
    };
    let args: Vec<&str> = base
        .iter()
        .copied()
        .chain(files.iter().map(String::as_str))
        .collect();
    git(&repo, &args).map(drop)
}

/// Throws away working tree changes. Untracked files are deleted.
#[tauri::command(async)]
pub fn discard(repo: String, files: Vec<FileChange>) -> Res<()> {
    let (untracked, tracked): (Vec<_>, Vec<_>) = files.iter().partition(|f| f.status == '?');
    if !tracked.is_empty() {
        let args: Vec<&str> = ["restore", "--"]
            .into_iter()
            .chain(tracked.iter().map(|f| f.path.as_str()))
            .collect();
        git(&repo, &args)?;
    }
    if !untracked.is_empty() {
        let args: Vec<&str> = ["clean", "-f", "--"]
            .into_iter()
            .chain(untracked.iter().map(|f| f.path.as_str()))
            .collect();
        git(&repo, &args)?;
    }
    Ok(())
}

/// `amend` replaces the last commit (new message + whatever is staged)
#[tauri::command(async)]
pub fn commit(repo: String, message: String, amend: bool) -> Res<()> {
    let mut args = vec!["commit", "-m", &message];
    if amend {
        args.push("--amend");
    }
    git(&repo, &args).map(drop)
}

/// Full message of the last commit, to pre-fill the box when amending
#[tauri::command(async)]
pub fn head_message(repo: String) -> Res<String> {
    Ok(git(&repo, &["log", "-1", "--format=%B"])?.trim_end().to_string())
}

#[tauri::command(async)]
pub fn fetch(repo: String) -> Res<()> {
    git(&repo, &["fetch", "--all", "--prune"]).map(drop)
}

/// Fast-forward only: never creates a merge commit behind the user's back
#[tauri::command(async)]
pub fn pull(repo: String) -> Res<()> {
    git(&repo, &["pull", "--ff-only"]).map(drop)
}

#[tauri::command(async)]
pub fn push(repo: String) -> Res<()> {
    if git(&repo, &["rev-parse", "--abbrev-ref", "@{u}"]).is_ok() {
        git(&repo, &["push"]).map(drop)
    } else {
        // first push of a new branch: create the upstream on origin
        git(&repo, &["push", "-u", "origin", "HEAD"]).map(drop)
    }
}

#[tauri::command(async)]
pub fn checkout(repo: String, branch: String, remote: bool) -> Res<()> {
    if remote {
        // origin/feature -> creates local "feature" tracking it
        git(&repo, &["switch", "--track", &branch]).map(drop)
    } else {
        git(&repo, &["switch", &branch]).map(drop)
    }
}

#[tauri::command(async)]
pub fn create_branch(repo: String, name: String, checkout: bool) -> Res<()> {
    if checkout {
        git(&repo, &["switch", "-c", &name]).map(drop)
    } else {
        git(&repo, &["branch", &name]).map(drop)
    }
}

// ---------- Search ----------

/// Commits whose message or author contains `query` (case-insensitive), or whose hash starts with it.
#[tauri::command(async)]
pub fn search(repo: String, query: String) -> Res<Vec<Commit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let mut found = Vec::new();
    for filter in [format!("--grep={q}"), format!("--author={q}")] {
        // --fixed-strings: "(" or "*" in the query are plain text, not regex
        let out = git(
            &repo,
            &[
                "log",
                "--all",
                "-i",
                "--fixed-strings",
                "--decorate=full",
                "-n",
                "300",
                &filter,
                LOG_FORMAT,
            ],
        )?;
        found.extend(parse::parse_log(&out));
    }
    let is_hash = q.len() >= 4 && q.chars().all(|c| c.is_ascii_hexdigit());
    if is_hash {
        if let Ok(hash) = git(
            &repo,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{q}^{{commit}}"),
            ],
        ) {
            let out = git(
                &repo,
                &[
                    "log",
                    "-1",
                    "--decorate=full",
                    LOG_FORMAT,
                    hash.trim(),
                    "--",
                ],
            )?;
            found.extend(parse::parse_log(&out));
        }
    }
    found.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    found.dedup_by(|a, b| a.hash == b.hash);
    Ok(found)
}

// ---------- Branches: merge, rebase, delete ----------

#[tauri::command(async)]
pub fn merge(repo: String, branch: String) -> Res<()> {
    git(&repo, &["merge", "--no-edit", &branch]).map(drop)
}

/// Replays the current branch on top of `onto`
#[tauri::command(async)]
pub fn rebase(repo: String, onto: String) -> Res<()> {
    git(&repo, &["rebase", &onto]).map(drop)
}

/// -d refuses to delete a branch that is not merged; -D (force) deletes anyway
#[tauri::command(async)]
pub fn delete_branch(repo: String, name: String, force: bool) -> Res<()> {
    git(&repo, &["branch", if force { "-D" } else { "-d" }, &name]).map(drop)
}

// ---------- Cherry-pick, revert, tags ----------

/// Copies a commit onto HEAD (cherry-pick) or adds a commit that undoes it (revert).
/// Conflicts leave the operation in progress, handled by `repo_state`/`operation`.
#[tauri::command(async)]
pub fn pick(repo: String, hash: String, revert: bool) -> Res<()> {
    let mut args = vec![if revert { "revert" } else { "cherry-pick" }, "--no-edit"];
    // a merge commit has two parents: compare against the first one (the branch it was merged into)
    let parent2 = format!("{hash}^2");
    if git(&repo, &["rev-parse", "--verify", "--quiet", &parent2]).is_ok() {
        args.extend(["-m", "1"]);
    }
    args.push(&hash);
    git(&repo, &args).map(drop)
}

/// Annotated tag when there is a message, lightweight otherwise
#[tauri::command(async)]
pub fn create_tag(repo: String, name: String, hash: String, message: String) -> Res<()> {
    let msg = message.trim();
    if msg.is_empty() {
        git(&repo, &["tag", &name, &hash]).map(drop)
    } else {
        git(&repo, &["tag", "-a", &name, "-m", msg, &hash]).map(drop)
    }
}

/// Local only; a tag already pushed stays on the remote
#[tauri::command(async)]
pub fn delete_tag(repo: String, name: String) -> Res<()> {
    git(&repo, &["tag", "-d", &name]).map(drop)
}

#[tauri::command(async)]
pub fn push_tag(repo: String, name: String) -> Res<()> {
    git(&repo, &["push", "origin", &format!("refs/tags/{name}")]).map(drop)
}

// ---------- Operation in progress (merge/rebase/cherry-pick/revert) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoState {
    /// "merge" | "rebase" | "cherry-pick" | "revert", None when nothing is in progress
    kind: Option<&'static str>,
    label: String,
    /// rebase progress like "2/5"
    step: Option<String>,
}

/// Git keeps the state of an unfinished operation as files inside .git
#[tauri::command(async)]
pub fn repo_state(repo: String) -> Res<RepoState> {
    let git_dir = git(&repo, &["rev-parse", "--absolute-git-dir"])?;
    let dir = Path::new(git_dir.trim());
    let read = |f: &str| {
        std::fs::read_to_string(dir.join(f))
            .ok()
            .map(|s| s.trim().to_string())
    };

    for rd in ["rebase-merge", "rebase-apply"] {
        if dir.join(rd).is_dir() {
            let head = read(&format!("{rd}/head-name")).unwrap_or_default();
            let head = head
                .strip_prefix("refs/heads/")
                .unwrap_or("HEAD")
                .to_string();
            // rebase-merge uses msgnum/end, rebase-apply uses next/last
            let now = read(&format!("{rd}/msgnum")).or_else(|| read(&format!("{rd}/next")));
            let total = read(&format!("{rd}/end")).or_else(|| read(&format!("{rd}/last")));
            let step = now.zip(total).map(|(a, b)| format!("{a}/{b}"));
            return Ok(RepoState {
                kind: Some("rebase"),
                label: format!("Rebase de {head}"),
                step,
            });
        }
    }
    let first_line = |f: &str| {
        read(f)
            .and_then(|m| m.lines().next().map(String::from))
            .unwrap_or_default()
    };
    let state = |kind, label| {
        Ok(RepoState {
            kind: Some(kind),
            label,
            step: None,
        })
    };
    if dir.join("MERGE_HEAD").exists() {
        return state("merge", first_line("MERGE_MSG"));
    }
    if dir.join("CHERRY_PICK_HEAD").exists() {
        return state("cherry-pick", "Cherry-pick em andamento".into());
    }
    if dir.join("REVERT_HEAD").exists() {
        return state("revert", "Revert em andamento".into());
    }
    Ok(RepoState {
        kind: None,
        label: String::new(),
        step: None,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpAction {
    Continue,
    Abort,
    /// rebase only: drop the current commit and go on
    Skip,
}

#[tauri::command(async)]
pub fn operation(repo: String, action: OpAction) -> Res<()> {
    let kind = repo_state(repo.clone())?
        .kind
        .ok_or("Nenhuma operação em andamento")?;
    let flag = match action {
        OpAction::Continue => "--continue",
        OpAction::Abort => "--abort",
        OpAction::Skip => "--skip",
    };
    git(&repo, &[kind, flag]).map(drop)
}

// ---------- Conflicts ----------

/// The conflicted file as it is on disk, with <<<<<<< ======= >>>>>>> blocks marked
#[tauri::command(async)]
pub fn conflict_view(repo: String, file: String) -> Res<Vec<DiffLine>> {
    let content = std::fs::read_to_string(Path::new(&repo).join(&file))
        .map_err(|e| format!("{file}: {e}"))?;
    Ok(parse::parse_conflicts(&content))
}

/// Keeps one side of one conflict block and saves the file
#[tauri::command(async)]
pub fn resolve_conflict_block(repo: String, file: String, block: usize, choice: Choice) -> Res<()> {
    let path = Path::new(&repo).join(&file);
    let content = std::fs::read_to_string(&path).map_err(|e| format!("{file}: {e}"))?;
    let resolved = parse::resolve_block(&content, block, choice)
        .ok_or("Conflito não encontrado, atualize a tela (F5)")?;
    std::fs::write(&path, resolved).map_err(|e| format!("{file}: {e}"))
}

/// Takes the whole file from one side and marks it resolved
#[tauri::command(async)]
pub fn resolve_file(repo: String, file: String, choice: Choice) -> Res<()> {
    let side = match choice {
        Choice::Ours => "--ours",
        Choice::Theirs => "--theirs",
        Choice::Both => return Err("Use a resolução por bloco para manter os dois lados".into()),
    };
    if git(&repo, &["checkout", side, "--", &file]).is_err() {
        // that side deleted the file: resolving = deleting it
        return git(&repo, &["rm", "-q", "--", &file]).map(drop);
    }
    git(&repo, &["add", "--", &file]).map(drop)
}

// ---------- Dashboard ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    name: Option<String>,
    email: Option<String>,
}

/// Identity from the global git config (`git config --global user.name/email`)
#[tauri::command(async)]
pub fn user_info() -> Res<UserInfo> {
    let get = |key: &str| {
        git(".", &["config", "--global", "--get", key]).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
    };
    Ok(UserInfo { name: get("user.name"), email: get("user.email") })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommit {
    subject: String,
    author: String,
    timestamp: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    path: String,
    name: String,
    head: Option<String>,
    last_commit: Option<LastCommit>,
    total_commits: u32,
    changes: usize,
    ahead: u32,
    behind: u32,
    /// Unix times of the user's commits in the last year (all branches)
    my_commits: Vec<i64>,
}

/// Everything a project card on the dashboard needs, in one call
#[tauri::command(async)]
pub fn repo_summary(repo: String, email: Option<String>) -> Res<RepoSummary> {
    let info = open_repo(repo.clone())?;
    let refs = refs(info.path.clone())?;
    let st = status(info.path.clone())?;
    let tr = tracking(info.path.clone())?;

    let last = git(&info.path, &["log", "-1", &format!("--format=%s{FS}%an{FS}%at")]).unwrap_or_default();
    let mut f = last.trim().split(FS);
    let last_commit = match (f.next(), f.next(), f.next()) {
        (Some(s), Some(a), Some(t)) if !s.is_empty() => {
            Some(LastCommit { subject: s.into(), author: a.into(), timestamp: t.parse().unwrap_or(0) })
        }
        _ => None,
    };
    // an empty repo has no HEAD: count is 0
    let total_commits = git(&info.path, &["rev-list", "--all", "--count"]).ok().and_then(|n| n.trim().parse().ok()).unwrap_or(0);

    let my_commits = match email.as_deref().filter(|e| !e.is_empty()) {
        Some(e) => git(&info.path, &["log", "--all", "--since=1.year", "--fixed-strings", &format!("--author={e}"), "--format=%at"])
            .unwrap_or_default()
            .lines()
            .filter_map(|t| t.parse().ok())
            .collect(),
        None => vec![],
    };

    Ok(RepoSummary {
        path: info.path,
        name: info.name,
        head: refs.head,
        last_commit,
        total_commits,
        changes: st.staged.len() + st.unstaged.len() + st.conflicted.len(),
        ahead: tr.ahead,
        behind: tr.behind,
        my_commits,
    })
}

// ---------- Stash ----------

#[tauri::command(async)]
pub fn stash_list(repo: String) -> Res<Vec<Stash>> {
    let out = git(
        &repo,
        &["stash", "list", &format!("--format=%gd{FS}%gs{FS}%ct")],
    )?;
    Ok(parse::parse_stash_list(&out))
}

/// Saves all changes (untracked included when asked) and cleans the working tree
#[tauri::command(async)]
pub fn stash_push(repo: String, message: String, untracked: bool) -> Res<()> {
    let mut args = vec!["stash", "push"];
    if untracked {
        args.push("--include-untracked");
    }
    if !message.trim().is_empty() {
        args.extend(["-m", message.trim()]);
    }
    git(&repo, &args).map(drop)
}

/// apply = keep the stash, pop = apply and delete, drop = delete
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StashAction {
    Apply,
    Pop,
    Drop,
}

#[tauri::command(async)]
pub fn stash_action(repo: String, name: String, action: StashAction) -> Res<()> {
    let verb = match action {
        StashAction::Apply => "apply",
        StashAction::Pop => "pop",
        StashAction::Drop => "drop",
    };
    git(&repo, &["stash", verb, &name]).map(drop)
}

const STASH_SHOW: [&str; 4] = ["stash", "show", "--include-untracked", "--no-renames"];

#[tauri::command(async)]
pub fn stash_files(repo: String, name: String) -> Res<Vec<FileChange>> {
    let names = git(
        &repo,
        &[&STASH_SHOW[..], &["--name-status", &name]].concat(),
    )?;
    let nums = git(&repo, &[&STASH_SHOW[..], &["--numstat", &name]].concat())?;
    Ok(parse::parse_changes(&names, &nums))
}

#[tauri::command(async)]
pub fn stash_diff(repo: String, name: String, file: String) -> Res<Vec<DiffLine>> {
    let full = git(&repo, &[&STASH_SHOW[..], &["-p", &name]].concat())?;
    Ok(parse::parse_diff(&parse::file_section(&full, &file)))
}

// ---------- Hunk staging ----------

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HunkAction {
    /// working tree -> index
    Stage,
    /// index -> back to working tree only
    Unstage,
    /// remove the change from the working tree (lost)
    Discard,
}

/// Applies one hunk of a file's diff, or only some of its lines when `lines` is given.
/// The diff is generated again here, so hunk numbers match what the UI showed
/// (same command, same file state).
#[tauri::command(async)]
pub fn apply_hunk(
    repo: String,
    file: String,
    hunk: usize,
    lines: Option<Vec<usize>>,
    action: HunkAction,
) -> Res<()> {
    let (diff_args, apply_args): (&[&str], &[&str]) = match action {
        HunkAction::Stage => (&["diff", "--no-renames"], &["apply", "--cached"]),
        HunkAction::Unstage => (
            &["diff", "--cached", "--no-renames"],
            &["apply", "--cached", "--reverse"],
        ),
        HunkAction::Discard => (&["diff", "--no-renames"], &["apply", "--reverse"]),
    };
    let diff = git(&repo, &[diff_args, &["--", &file]].concat())?;
    let patch = match &lines {
        None => parse::hunk_patch(&diff, hunk),
        Some(l) => parse::lines_patch(&diff, hunk, l, !matches!(action, HunkAction::Stage)),
    }
    .ok_or("O trecho mudou, atualize a tela (F5)")?;
    git_with_input(&repo, &[apply_args, &["-"]].concat(), Some(&patch)).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end check against a real temporary repository
    #[test]
    fn real_repo_flow() {
        let dir = std::env::temp_dir().join(format!("will-repo-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        let r = || repo.clone();
        git(&repo, &["init", "-q", "-b", "main"]).unwrap();
        git(&repo, &["config", "user.name", "Test"]).unwrap();
        git(&repo, &["config", "user.email", "t@t"]).unwrap();

        // empty repo: no commits, no crash
        assert!(log(r(), 1000).unwrap().is_empty());

        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        let st = status(r()).unwrap();
        assert_eq!(st.unstaged[0].status, '?');

        stage(r(), vec!["a.txt".into()]).unwrap();
        unstage(r(), vec!["a.txt".into()]).unwrap(); // works without HEAD
        stage(r(), vec!["a.txt".into()]).unwrap();
        commit(r(), "first".into(), false).unwrap();

        create_branch(r(), "feature/x".into(), true).unwrap();
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        let d = working_diff(r(), "a.txt".into(), false, false).unwrap();
        assert!(d
            .iter()
            .any(|l| l.kind == parse::DiffKind::Add && l.text == "two"));
        stage(r(), vec!["a.txt".into()]).unwrap();
        commit(r(), "second".into(), false).unwrap();

        checkout(r(), "main".into(), false).unwrap();
        git(
            &repo,
            &["merge", "--no-ff", "-q", "-m", "merge", "feature/x"],
        )
        .unwrap();

        let commits = log(r(), 1000).unwrap();
        let subjects: Vec<_> = commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, vec!["merge", "second", "first"]);
        assert_eq!(commits[0].parents.len(), 2);

        let files = commit_files(r(), commits[1].hash.clone()).unwrap();
        assert_eq!(
            (files[0].path.as_str(), files[0].add, files[0].del),
            ("a.txt", 1, 0)
        );
        // merge commit compared with its first parent
        assert_eq!(commit_files(r(), commits[0].hash.clone()).unwrap().len(), 1);

        let refs = refs(r()).unwrap();
        assert_eq!(refs.head.as_deref(), Some("main"));
        assert_eq!(refs.branches, vec!["feature/x", "main"]);

        std::fs::write(dir.join("a.txt"), "changed\n").unwrap();
        std::fs::write(dir.join("junk.txt"), "x\n").unwrap();
        let st = status(r()).unwrap();
        discard(r(), st.unstaged).unwrap();
        assert!(status(r()).unwrap().unstaged.is_empty());

        assert!(tracking(r()).unwrap().upstream.is_none());
        assert!(open_repo(std::env::temp_dir().to_string_lossy().into_owned()).is_err());

        // Hunk staging: two changes far apart become two hunks
        let lines: Vec<String> = (1..=20).map(|n| format!("line {n}")).collect();
        std::fs::write(dir.join("long.txt"), lines.join("\n") + "\n").unwrap();
        stage(r(), vec!["long.txt".into()]).unwrap();
        commit(r(), "long".into(), false).unwrap();
        let mut edited = lines.clone();
        edited[0] = "FIRST".into();
        edited[19] = "LAST".into();
        std::fs::write(dir.join("long.txt"), edited.join("\n") + "\n").unwrap();

        apply_hunk(r(), "long.txt".into(), 1, None, HunkAction::Stage).unwrap();
        let staged = git(&repo, &["diff", "--cached"]).unwrap();
        assert!(staged.contains("+LAST") && !staged.contains("+FIRST"));

        apply_hunk(r(), "long.txt".into(), 0, None, HunkAction::Unstage).unwrap();
        assert!(git(&repo, &["diff", "--cached"]).unwrap().is_empty());

        apply_hunk(r(), "long.txt".into(), 0, None, HunkAction::Discard).unwrap();
        let left = git(&repo, &["diff"]).unwrap();
        assert!(left.contains("+LAST") && !left.contains("+FIRST"));
        assert!(apply_hunk(r(), "long.txt".into(), 5, None, HunkAction::Stage).is_err());

        // Line staging: both lines change, stage only the first one
        std::fs::write(dir.join("pair.txt"), "x\ny\n").unwrap();
        stage(r(), vec!["pair.txt".into()]).unwrap();
        commit(r(), "pair".into(), false).unwrap();
        std::fs::write(dir.join("pair.txt"), "X\nY\n").unwrap();
        // body: 0 "-x", 1 "-y", 2 "+X", 3 "+Y"
        apply_hunk(
            r(),
            "pair.txt".into(),
            0,
            Some(vec![0, 2]),
            HunkAction::Stage,
        )
        .unwrap();
        assert_eq!(git(&repo, &["show", ":pair.txt"]).unwrap(), "X\ny\n");
        // cached body: 0 "-x", 1 "+X"
        apply_hunk(
            r(),
            "pair.txt".into(),
            0,
            Some(vec![0, 1]),
            HunkAction::Unstage,
        )
        .unwrap();
        assert_eq!(git(&repo, &["show", ":pair.txt"]).unwrap(), "x\ny\n");
        // discard only "Y" in the working tree: body 0 "-x", 1 "-y", 2 "+X", 3 "+Y"
        apply_hunk(
            r(),
            "pair.txt".into(),
            0,
            Some(vec![1, 3]),
            HunkAction::Discard,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("pair.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "X\ny\n"
        );
        git(&repo, &["checkout", "--", "pair.txt"]).unwrap();

        // Stash: save, inspect, pop back
        std::fs::write(dir.join("extra.txt"), "x\n").unwrap();
        stash_push(r(), "meu stash".into(), true).unwrap();
        assert!(status(r()).unwrap().unstaged.is_empty());
        let stashes = stash_list(r()).unwrap();
        assert_eq!(stashes[0].name, "stash@{0}");
        assert!(stashes[0].message.ends_with("meu stash"));
        let files = stash_files(r(), "stash@{0}".into()).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["extra.txt", "long.txt"]);
        let d = stash_diff(r(), "stash@{0}".into(), "long.txt".into()).unwrap();
        assert!(d.iter().any(|l| l.text == "LAST"));
        stash_action(r(), "stash@{0}".into(), StashAction::Pop).unwrap();
        assert!(stash_list(r()).unwrap().is_empty());
        assert_eq!(status(r()).unwrap().unstaged.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// New temp repo with one commit of `f.txt`; returns (dir, path string)
    fn temp_repo(name: &str) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("will-repo-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, &["init", "-q", "-b", "main"]).unwrap();
        git(&repo, &["config", "user.name", "Test"]).unwrap();
        git(&repo, &["config", "user.email", "t@t"]).unwrap();
        git(&repo, &["config", "core.autocrlf", "false"]).unwrap();
        std::fs::write(dir.join("f.txt"), "base\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-q", "-m", "base"]).unwrap();
        (dir, repo)
    }

    /// main and feature both change f.txt -> conflict
    fn diverge(dir: &Path, repo: &str) {
        git(repo, &["switch", "-q", "-c", "feature"]).unwrap();
        std::fs::write(dir.join("f.txt"), "feature\n").unwrap();
        git(repo, &["commit", "-q", "-am", "feature change"]).unwrap();
        git(repo, &["switch", "-q", "main"]).unwrap();
        std::fs::write(dir.join("f.txt"), "main\n").unwrap();
        git(repo, &["commit", "-q", "-am", "main change"]).unwrap();
    }

    #[test]
    fn merge_conflict_resolve_by_block_and_continue() {
        let (dir, repo) = temp_repo("merge");
        let r = || repo.clone();
        diverge(&dir, &repo);

        assert!(merge(r(), "feature".into())
            .unwrap_err()
            .contains("CONFLICT"));
        let st = repo_state(r()).unwrap();
        assert_eq!(st.kind, Some("merge"));
        assert_eq!(status(r()).unwrap().conflicted[0].path, "f.txt");

        let view = conflict_view(r(), "f.txt".into()).unwrap();
        assert!(view
            .iter()
            .any(|l| l.kind == parse::DiffKind::Theirs && l.text == "feature"));

        resolve_conflict_block(r(), "f.txt".into(), 0, Choice::Both).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("f.txt")).unwrap(),
            "main\nfeature\n"
        );
        stage(r(), vec!["f.txt".into()]).unwrap();
        operation(r(), OpAction::Continue).unwrap();

        assert_eq!(repo_state(r()).unwrap().kind, None);
        assert_eq!(log(r(), 10).unwrap()[0].parents.len(), 2);

        delete_branch(r(), "feature".into(), false).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rebase_conflict_resolve_file_then_abort_and_redo() {
        let (dir, repo) = temp_repo("rebase");
        let r = || repo.clone();
        diverge(&dir, &repo);
        git(&repo, &["switch", "-q", "feature"]).unwrap();

        assert!(rebase(r(), "main".into()).is_err());
        let st = repo_state(r()).unwrap();
        assert_eq!(
            (st.kind, st.label.as_str(), st.step.as_deref()),
            (Some("rebase"), "Rebase de feature", Some("1/1"))
        );

        operation(r(), OpAction::Abort).unwrap();
        assert_eq!(repo_state(r()).unwrap().kind, None);

        assert!(rebase(r(), "main".into()).is_err());
        // during a rebase "theirs" is the commit being replayed (feature's version)
        resolve_file(r(), "f.txt".into(), Choice::Theirs).unwrap();
        assert!(status(r()).unwrap().conflicted.is_empty());
        operation(r(), OpAction::Continue).unwrap();

        let commits = log(r(), 10).unwrap();
        let subjects: Vec<_> = commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, vec!["feature change", "main change", "base"]);
        assert_eq!(
            std::fs::read_to_string(dir.join("f.txt")).unwrap(),
            "feature\n"
        );

        // search: message, author, hash prefix
        assert_eq!(
            search(r(), "FEATURE".into()).unwrap()[0].subject,
            "feature change"
        );
        assert_eq!(search(r(), "test".into()).unwrap().len(), 3);
        let short = &commits[2].hash[..7];
        assert_eq!(search(r(), short.into()).unwrap()[0].subject, "base");
        assert!(search(r(), "(".into()).unwrap().is_empty());

        // not merged into main yet: -d refuses, -D works
        git(&repo, &["switch", "-q", "main"]).unwrap();
        assert!(delete_branch(r(), "feature".into(), false).is_err());
        delete_branch(r(), "feature".into(), true).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn amend_pick_revert_tags() {
        let (dir, repo) = temp_repo("pick");
        let r = || repo.clone();

        // amend: message only, then with a staged file
        commit(r(), "base editado".into(), true).unwrap();
        assert_eq!(head_message(r()).unwrap(), "base editado");
        std::fs::write(dir.join("g.txt"), "g
").unwrap();
        stage(r(), vec!["g.txt".into()]).unwrap();
        commit(r(), "base com g".into(), true).unwrap();
        assert_eq!(log(r(), 10).unwrap().len(), 1);
        assert!(status(r()).unwrap().staged.is_empty());

        // cherry-pick a commit from feature onto main, then revert it
        git(&repo, &["switch", "-q", "-c", "feature"]).unwrap();
        std::fs::write(dir.join("h.txt"), "h
").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-q", "-m", "add h"]).unwrap();
        let h = git(&repo, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        git(&repo, &["switch", "-q", "main"]).unwrap();
        pick(r(), h.clone(), false).unwrap();
        assert!(dir.join("h.txt").exists());
        pick(r(), "HEAD".into(), true).unwrap();
        assert!(!dir.join("h.txt").exists());
        assert!(head_message(r()).unwrap().starts_with("Revert \"add h\""));

        // conflicting cherry-pick stays in progress until aborted
        std::fs::write(dir.join("f.txt"), "main
").unwrap();
        git(&repo, &["commit", "-q", "-am", "main f"]).unwrap();
        git(&repo, &["switch", "-q", "feature"]).unwrap();
        std::fs::write(dir.join("f.txt"), "feature
").unwrap();
        git(&repo, &["commit", "-q", "-am", "feature f"]).unwrap();
        git(&repo, &["switch", "-q", "main"]).unwrap();
        assert!(pick(r(), "feature".into(), false).is_err());
        assert_eq!(repo_state(r()).unwrap().kind, Some("cherry-pick"));
        operation(r(), OpAction::Abort).unwrap();
        assert_eq!(repo_state(r()).unwrap().kind, None);

        // merge commit: picked with -m 1
        git(&repo, &["merge", "-q", "--no-ff", "-X", "theirs", "-m", "merge feature", "feature"]).unwrap();
        pick(r(), "HEAD".into(), true).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("f.txt")).unwrap(), "main
");

        // tags: lightweight and annotated
        create_tag(r(), "v1".into(), h.clone(), "".into()).unwrap();
        create_tag(r(), "v2".into(), "HEAD".into(), "versão 2".into()).unwrap();
        assert_eq!(refs(r()).unwrap().tags, vec!["v1", "v2"]);
        assert_eq!(git(&repo, &["cat-file", "-t", "v2"]).unwrap().trim(), "tag");
        delete_tag(r(), "v1".into()).unwrap();
        assert_eq!(refs(r()).unwrap().tags, vec!["v2"]);
        assert!(push_tag(r(), "v2".into()).is_err()); // no origin
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dashboard_summary() {
        let (dir, repo) = temp_repo("summary");
        std::fs::write(dir.join("g.txt"), "x\n").unwrap();
        let s = repo_summary(repo.clone(), Some("t@t".into())).unwrap();
        assert_eq!((s.total_commits, s.changes, s.head.as_deref()), (1, 1, Some("main")));
        assert_eq!(s.last_commit.unwrap().subject, "base");
        assert_eq!(s.my_commits.len(), 1);
        assert!(repo_summary(repo.clone(), Some("ninguem@x".into())).unwrap().my_commits.is_empty());
        assert!(user_info().is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
