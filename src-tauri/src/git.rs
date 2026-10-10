// Tauri commands: each one runs the git CLI and returns parsed data to React.
// `#[tauri::command(async)]` runs the function on a worker thread,
// so a slow push doesn't freeze the window (like TThread in Delphi).

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use serde::{Deserialize, Serialize};

use crate::parse::{self, BlameLine, Choice, Commit, DiffLine, FileChange, Refs, Stash, Status, FS};

type Res<T> = Result<T, String>;

fn run(repo: &str, args: &[&str]) -> Res<Output> {
    run_with_input(repo, args, None)
}

/// git command with the app's defaults, not started yet
fn command(repo: &str, args: &[&str]) -> Command {
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
    cmd
}

/// Same as `run`, optionally writing `input` to git's stdin (used by `git apply -`)
fn run_with_input(repo: &str, args: &[&str], input: Option<&str>) -> Res<Output> {
    let mut cmd = command(repo, args);
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
pub(crate) fn git(repo: &str, args: &[&str]) -> Res<String> {
    git_with_input(repo, args, None)
}

fn git_with_input(repo: &str, args: &[&str], input: Option<&str>) -> Res<String> {
    check(run_with_input(repo, args, input)?, args)
}

/// stdout on success, stderr (or stdout) as the error otherwise
fn check(out: Output, args: &[&str]) -> Res<String> {
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

/// Startup check: is git installed and on the PATH?
#[tauri::command(async)]
pub fn git_version() -> Res<String> {
    git(".", &["--version"]).map(|v| v.trim().to_string())
}

/// Clones `url` into the folder `dest` (which must not exist yet) and returns the repo info
#[tauri::command(async)]
pub fn clone_repo(url: String, dest: String) -> Res<RepoInfo> {
    if Path::new(&dest).exists() {
        return Err(format!("A pasta {dest} já existe"));
    }
    let parent = Path::new(&dest).parent().ok_or("Pasta inválida")?.to_string_lossy().into_owned();
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    // the login window of the Git Credential Manager may open for private repositories
    git(&parent, &["clone", "--recurse-submodules", &url, &dest])?;
    open_repo(dest)
}

#[derive(Serialize, Debug)]
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
const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e";
// same fields for stashes; %gd = "stash@{0}", %gs = its message
const STASH_LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%gd%x1f%gs%x1e";

/// Newest `limit` commits. "Load more" asks again with a bigger limit:
/// lanes need the history from the top, so we don't page with --skip.
/// Focus mode: `solo` shows only that branch; `hidden` branches leave the graph
/// (their commits still show when another branch reaches them).
// ponytail: re-reads everything on "load more", fine for tens of thousands of commits
#[tauri::command(async)]
pub fn log(repo: String, limit: usize, solo: Option<String>, hidden: Vec<String>) -> Res<Vec<Commit>> {
    let n = limit.to_string();
    let mut args: Vec<String> = ["log", "--date-order", "--decorate=full", "-n", &n, LOG_FORMAT]
        .map(String::from)
        .to_vec();
    match &solo {
        Some(branch) => {
            // a remote branch name like origin/x needs the full ref to be unambiguous
            let is_local = git(&repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok();
            args.push(if is_local { format!("refs/heads/{branch}") } else { format!("refs/remotes/{branch}") });
            args.push("--".into());
        }
        None => {
            for h in &hidden {
                args.push(format!("--exclude=refs/heads/{h}"));
                args.push(format!("--exclude=refs/remotes/{h}"));
            }
            // stashes are added below as single nodes, not as their internal commits
            args.push("--exclude=refs/stash".into());
            args.push("--all".into());
        }
    }
    let out = git(&repo, &args.iter().map(String::as_str).collect::<Vec<_>>())?;
    let mut commits = parse::parse_log(&out);
    if solo.is_none() {
        let stashes = git(&repo, &["stash", "list", STASH_LOG_FORMAT]).unwrap_or_default();
        parse::insert_stashes(&mut commits, parse::parse_stash_nodes(&stashes));
    }
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

/// Diff options from the settings screen: lines of context (-U) and, for read-only
/// diffs, ignoring whitespace (-w). Working tree diffs never ignore whitespace,
/// because their hunks must apply back with `git apply`.
fn diff_opts(context: u32, ignore_ws: bool) -> Vec<String> {
    let mut v = vec![format!("-U{}", context.clamp(1, 50))];
    if ignore_ws {
        v.push("-w".into());
    }
    v
}

fn with_opts<'a>(base: &[&'a str], opts: &'a [String], rest: &[&'a str]) -> Vec<&'a str> {
    base.iter().copied().chain(opts.iter().map(String::as_str)).chain(rest.iter().copied()).collect()
}

#[tauri::command(async)]
pub fn commit_diff(repo: String, hash: String, file: String, context: u32, ignore_ws: bool) -> Res<Vec<DiffLine>> {
    let opts = diff_opts(context, ignore_ws);
    let out = git(&repo, &with_opts(&SHOW, &opts, &[&hash, "--", &file]))?;
    Ok(parse::parse_diff(&out))
}

/// Diff of an uncommitted file. `staged` picks index vs working tree.
#[tauri::command(async)]
pub fn working_diff(
    repo: String,
    file: String,
    staged: bool,
    untracked: bool,
    context: u32,
) -> Res<Vec<DiffLine>> {
    let opts = diff_opts(context, false);
    let out = if untracked {
        // --no-index exits with 1 when files differ, which is the normal case here
        let out = run(&repo, &with_opts(&["diff", "--no-index"], &opts, &["--", "/dev/null", &file]))?;
        String::from_utf8_lossy(&out.stdout).into_owned()
    } else if staged {
        git(&repo, &with_opts(&["diff", "--cached", "--no-renames"], &opts, &["--", &file]))?
    } else {
        git(&repo, &with_opts(&["diff", "--no-renames"], &opts, &["--", &file]))?
    };
    Ok(parse::parse_diff(&out))
}

/// Raw bytes of one version of a file, for the image diff.
/// `rev`: a commit ("abc123", "abc123^", "stash@{0}^1"), "INDEX" (staged) or "WORKTREE" (on disk).
/// Empty when the file doesn't exist in that version (added or deleted).
/// `Response` sends the bytes as an ArrayBuffer, without JSON or base64.
#[tauri::command(async)]
pub fn file_blob(repo: String, rev: String, path: String) -> Res<tauri::ipc::Response> {
    blob_bytes(&repo, &rev, &path).map(tauri::ipc::Response::new)
}

fn blob_bytes(repo: &str, rev: &str, path: &str) -> Res<Vec<u8>> {
    Ok(match rev {
        "WORKTREE" => std::fs::read(Path::new(repo).join(path)).unwrap_or_default(),
        _ => {
            let spec = if rev == "INDEX" { format!(":{path}") } else { format!("{rev}:{path}") };
            let out = run(repo, &["show", &spec])?;
            if out.status.success() { out.stdout } else { vec![] }
        }
    })
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
/// A backup is saved first, so `restore_discard` can bring them back.
#[tauri::command(async)]
pub fn discard(repo: String, files: Vec<FileChange>) -> Res<()> {
    backup(&repo, &files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>())?;
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

/// Full message (subject + body) of a commit; "HEAD" pre-fills the box when amending
#[tauri::command(async)]
pub fn commit_message(repo: String, rev: String) -> Res<String> {
    Ok(git(&repo, &["log", "-1", "--format=%B", &rev, "--"])?.trim_end().to_string())
}

/// `background` (auto fetch): fail instead of opening the Git Credential Manager window
#[tauri::command(async)]
pub fn fetch(repo: String, background: bool) -> Res<()> {
    let args = ["fetch", "--all", "--prune"];
    let mut cmd = command(&repo, &args);
    if background {
        cmd.env("GCM_INTERACTIVE", "never");
    }
    check(cmd.output().map_err(|e| e.to_string())?, &args).map(drop)
}

/// `mode` from the settings: "ff-only" (default: never creates a merge commit behind
/// the user's back), "rebase" or "merge"
#[tauri::command(async)]
pub fn pull(repo: String, mode: String) -> Res<()> {
    let flag = match mode.as_str() {
        "rebase" => "--rebase",
        "merge" => "--no-rebase",
        _ => "--ff-only",
    };
    git(&repo, &["pull", flag]).map(drop)
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

/// `from`: start point (a branch or commit); None = the current HEAD
#[tauri::command(async)]
pub fn create_branch(repo: String, name: String, checkout: bool, from: Option<String>) -> Res<()> {
    let from = from.filter(|f| !f.trim().is_empty());
    let mut args = if checkout { vec!["switch", "-c", &name] } else { vec!["branch", &name] };
    if let Some(f) = &from {
        // a remote branch as start point (origin/main) should not become the upstream
        args.extend(["--no-track", f.as_str()]);
    }
    git(&repo, &args).map(drop)
}

/// The repository's main branch: main, master or develop, whichever exists
#[tauri::command(async)]
pub fn default_branch(repo: String) -> Res<String> {
    for b in ["main", "master", "develop"] {
        if git(&repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_ok() {
            return Ok(b.into());
        }
    }
    Ok(git(&repo, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string())
}

/// Branch templates: finishing feature/x merges it into `base` (always with a merge
/// commit, so the feature stays visible in the graph), optionally tags, then deletes it.
/// A merge conflict stops here, with the merge in progress for the user to resolve.
#[tauri::command(async)]
pub fn finish_branch(repo: String, name: String, base: String, tag: Option<String>) -> Res<()> {
    git(&repo, &["switch", &base])?;
    git(&repo, &["merge", "--no-ff", "--no-edit", &name])?;
    if let Some(t) = tag.filter(|t| !t.trim().is_empty()) {
        git(&repo, &["tag", "-a", t.trim(), "-m", &format!("Release {}", t.trim())])?;
    }
    git(&repo, &["branch", "-d", &name]).map(drop)
}

// ---------- Time machine (reflog) and undo ----------

/// One move of HEAD: commit, checkout, reset, merge, rebase...
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    hash: String,
    /// "HEAD@{3}"
    selector: String,
    /// "commit", "checkout", "reset", "merge", "rebase"...
    action: String,
    /// the rest of git's description ("moving from main to feature", the commit subject...)
    message: String,
    timestamp: i64,
}

fn parse_reflog(out: &str) -> Vec<ReflogEntry> {
    out.split('\u{1e}')
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let f: Vec<&str> = r.split(FS).collect();
            if f.len() < 4 {
                return None;
            }
            // "commit (amend): msg" -> ("commit (amend)", "msg"); "merge feature: ..." -> "merge"
            let (head, message) = f[2].split_once(": ").unwrap_or((f[2], ""));
            let action = if head.starts_with("merge ") { "merge" } else { head };
            Some(ReflogEntry {
                hash: f[0].into(),
                selector: f[1].into(),
                action: action.into(),
                message: message.into(),
                timestamp: f[3].parse().unwrap_or(0),
            })
        })
        .collect()
}

/// Every position HEAD had, newest first. Recovers "lost" commits after a reset or rebase.
#[tauri::command(async)]
pub fn reflog(repo: String, limit: usize) -> Res<Vec<ReflogEntry>> {
    let n = limit.to_string();
    let out = git(&repo, &["reflog", "show", "-n", &n, "--format=%H%x1f%gd%x1f%gs%x1f%ct%x1e", "HEAD"])
        // a new repository without commits has no reflog yet
        .unwrap_or_default();
    Ok(parse_reflog(&out))
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoPlan {
    /// shown before doing it: "Desfazer o commit \"x\"..."
    description: String,
    #[serde(skip)]
    args: Vec<String>,
}

/// What undoing the last move of HEAD means, based on the reflog
fn plan_undo(repo: &str) -> Res<UndoPlan> {
    let last = reflog(repo.into(), 1)?.into_iter().next().ok_or("Nada para desfazer ainda")?;
    let has_previous = git(repo, &["rev-parse", "--verify", "--quiet", "HEAD@{1}"]).is_ok();
    let plan = |description: String, args: &[&str]| Ok(UndoPlan { description, args: args.iter().map(|a| a.to_string()).collect() });
    match last.action.as_str() {
        "commit" | "commit (amend)" | "cherry-pick" | "revert" if has_previous => plan(
            // --soft: the commit goes away, its changes stay staged
            format!("Desfazer \"{}\" ({}). As alterações voltam para preparados.", last.message, last.action),
            &["reset", "--soft", "HEAD@{1}"],
        ),
        "checkout" => {
            let from = last.message.strip_prefix("moving from ").and_then(|m| m.split(" to ").next()).ok_or("Checkout sem origem")?;
            let is_branch = git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{from}")]).is_ok();
            if is_branch {
                plan(format!("Voltar para a branch {from}"), &["switch", from])
            } else {
                plan(format!("Voltar para {from}"), &["switch", "--detach", from])
            }
        }
        // a rebase leaves many reflog entries; ORIG_HEAD is where the branch was before it
        a if a.starts_with("rebase") => plan("Desfazer o rebase (a branch volta para antes dele)".into(), &["reset", "--keep", "ORIG_HEAD"]),
        // --keep: refuses instead of overwriting local changes
        "merge" | "commit (merge)" | "pull" | "reset" if has_previous => {
            plan(format!("Desfazer o {} ({})", last.action, last.message), &["reset", "--keep", "HEAD@{1}"])
        }
        _ => Err(format!("Não sei desfazer \"{}: {}\". Use a máquina do tempo.", last.action, last.message)),
    }
}

#[tauri::command(async)]
pub fn undo_preview(repo: String) -> Res<UndoPlan> {
    plan_undo(&repo)
}

/// Undoes the last move of HEAD and returns what was done
#[tauri::command(async)]
pub fn undo(repo: String) -> Res<String> {
    let plan = plan_undo(&repo)?;
    git(&repo, &plan.args.iter().map(String::as_str).collect::<Vec<_>>())?;
    Ok(plan.description)
}

/// Time machine actions on any reflog position
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RestoreAction {
    /// new branch pointing there (safest)
    Branch,
    /// look around there, detached
    Checkout,
    /// move the current branch there, keeping local changes
    Reset,
}

#[tauri::command(async)]
pub fn restore(repo: String, hash: String, action: RestoreAction, name: Option<String>) -> Res<()> {
    match action {
        RestoreAction::Branch => git(&repo, &["branch", name.as_deref().ok_or("Falta o nome da branch")?, &hash]),
        RestoreAction::Checkout => git(&repo, &["switch", "--detach", &hash]),
        RestoreAction::Reset => git(&repo, &["reset", "--keep", &hash]),
    }
    .map(drop)
}

// ---------- Repository structure: submodules, worktrees, LFS ----------

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    path: String,
    /// full path, to open it in a new tab
    abs_path: String,
    hash: String,
    /// "ok" | "uninitialized" | "modified" (checked out at another commit) | "conflict"
    state: &'static str,
}

/// `git submodule status`: "<state char><sha> <path> (<describe>)"
fn parse_submodules(repo: &str, out: &str) -> Vec<Submodule> {
    out.lines()
        .filter(|l| l.len() > 41)
        .map(|l| {
            let state = match l.as_bytes()[0] {
                b'-' => "uninitialized",
                b'+' => "modified",
                b'U' => "conflict",
                _ => "ok",
            };
            let rest = &l[1..];
            let (hash, rest) = rest.split_once(' ').unwrap_or((rest, ""));
            let path = rest.split(" (").next().unwrap_or(rest).trim().to_string();
            Submodule {
                abs_path: Path::new(repo).join(&path).to_string_lossy().replace('\\', "/"),
                path,
                hash: hash.into(),
                state,
            }
        })
        .collect()
}

#[tauri::command(async)]
pub fn submodules(repo: String) -> Res<Vec<Submodule>> {
    let out = git(&repo, &["submodule", "status", "--recursive"]).unwrap_or_default();
    Ok(parse_submodules(&repo, &out))
}

/// Clones missing submodules and checks each one out at the commit the repo expects
#[tauri::command(async)]
pub fn submodule_update(repo: String, path: Option<String>) -> Res<()> {
    let mut args = vec!["submodule", "update", "--init", "--recursive"];
    if let Some(p) = &path {
        args.extend(["--", p.as_str()]);
    }
    git(&repo, &args).map(drop)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    path: String,
    head: String,
    /// None = detached HEAD
    branch: Option<String>,
    /// the original folder (cannot be removed)
    main: bool,
}

/// `git worktree list --porcelain`: blocks of "worktree <path>", "HEAD <sha>", "branch <ref>"
fn parse_worktrees(out: &str) -> Vec<Worktree> {
    out.split("\n\n")
        .filter(|b| b.starts_with("worktree "))
        .enumerate()
        .map(|(i, block)| {
            let field = |k: &str| block.lines().find_map(|l| l.strip_prefix(k)).map(str::to_string);
            Worktree {
                path: field("worktree ").unwrap_or_default(),
                head: field("HEAD ").unwrap_or_default(),
                branch: field("branch refs/heads/"),
                main: i == 0,
            }
        })
        .collect()
}

#[tauri::command(async)]
pub fn worktrees(repo: String) -> Res<Vec<Worktree>> {
    Ok(parse_worktrees(&git(&repo, &["worktree", "list", "--porcelain"])?))
}

/// A second folder with another branch checked out. `new_branch` creates it from HEAD.
#[tauri::command(async)]
pub fn worktree_add(repo: String, path: String, branch: String, new_branch: bool) -> Res<()> {
    if new_branch {
        git(&repo, &["worktree", "add", "-b", &branch, &path]).map(drop)
    } else {
        git(&repo, &["worktree", "add", &path, &branch]).map(drop)
    }
}

/// Deletes the folder (its branch stays). `force` also discards its uncommitted changes.
#[tauri::command(async)]
pub fn worktree_remove(repo: String, path: String, force: bool) -> Res<()> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path);
    git(&repo, &args).map(drop)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LfsStatus {
    /// git-lfs is installed on this machine
    installed: bool,
    /// tracked patterns from .gitattributes ("*.psd")
    patterns: Vec<String>,
    /// files stored in LFS at HEAD
    files: Vec<String>,
}

#[tauri::command(async)]
pub fn lfs_status(repo: String) -> Res<LfsStatus> {
    if git(&repo, &["lfs", "version"]).is_err() {
        return Ok(LfsStatus { installed: false, patterns: vec![], files: vec![] });
    }
    // "Listing tracked patterns\n    *.psd (.gitattributes)\nListing excluded patterns"
    let tracked = git(&repo, &["lfs", "track"]).unwrap_or_default();
    let patterns = tracked
        .lines()
        .take_while(|l| !l.starts_with("Listing excluded"))
        .filter_map(|l| l.strip_prefix("    "))
        .map(|l| l.rsplit_once(" (").map_or(l, |(p, _)| p).trim().to_string())
        .collect();
    let files = git(&repo, &["lfs", "ls-files", "--name-only"]).unwrap_or_default().lines().map(String::from).collect();
    Ok(LfsStatus { installed: true, patterns, files })
}

/// Start (`track`) or stop storing files matching `pattern` in LFS; edits .gitattributes
#[tauri::command(async)]
pub fn lfs_track(repo: String, pattern: String, track: bool) -> Res<()> {
    git(&repo, &["lfs", if track { "track" } else { "untrack" }, &pattern]).map(drop)
}

// ---------- Files at any commit: tree, history, blame ----------

/// Every file path at `rev` (a commit or "HEAD")
#[tauri::command(async)]
pub fn tree(repo: String, rev: String) -> Res<Vec<String>> {
    let out = git(&repo, &["ls-tree", "-r", "--name-only", "-z", &rev])?;
    Ok(out.split('\0').filter(|p| !p.is_empty()).map(String::from).collect())
}

/// Commits that changed `path`, newest first, following renames
#[tauri::command(async)]
pub fn file_history(repo: String, path: String, limit: usize) -> Res<Vec<Commit>> {
    let n = limit.to_string();
    let out = git(&repo, &["log", "--follow", "--decorate=full", "-n", &n, LOG_FORMAT, "--", &path])?;
    Ok(parse::parse_log(&out))
}

/// Who last changed each line of `path` as of `rev`
#[tauri::command(async)]
pub fn blame(repo: String, rev: String, path: String) -> Res<Vec<BlameLine>> {
    let out = git(&repo, &["blame", "--porcelain", &rev, "--", &path])?;
    Ok(parse::parse_blame(&out))
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

/// -d refuses to delete a branch that is not merged; -D (force) deletes anyway.
/// Returns the commit it pointed to, so Ctrl+Z can bring it back.
#[tauri::command(async)]
pub fn delete_branch(repo: String, name: String, force: bool) -> Res<String> {
    let hash = git(&repo, &["rev-parse", &format!("refs/heads/{name}")])?.trim().to_string();
    git(&repo, &["branch", if force { "-D" } else { "-d" }, &name])?;
    Ok(hash)
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

// ---------- Settings: identity, editor, terminal ----------

/// Changes the global `user.name` / `user.email`
#[tauri::command(async)]
pub fn set_user_info(name: String, email: String) -> Res<()> {
    for (key, value) in [("user.name", name.trim()), ("user.email", email.trim())] {
        if value.is_empty() {
            // exit code 5 = key was not set: nothing to remove
            let _ = git(".", &["config", "--global", "--unset", key]);
        } else {
            git(".", &["config", "--global", key, value])?;
        }
    }
    Ok(())
}

/// Name and email used automatically for every repository inside `folder`
#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    folder: String,
    name: String,
    email: String,
}

/// Where our include files live: ~/.config/will-repo/identity-N.gitconfig
fn identity_dir() -> Res<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Pasta do usuário não encontrada".to_string())?;
    Ok(Path::new(&home).join(".config").join("will-repo"))
}

/// git's own feature: `[includeIf "gitdir/i:D:/Work/"] path = file` loads `file`
/// (with user.name/email) only for repositories under D:/Work/.
/// `scope` is ["--global"] in the app and ["-f", file] in tests.
fn read_identities(scope: &[&str], dir: &Path) -> Vec<Identity> {
    let dir = dir.to_string_lossy().replace('\\', "/");
    let Ok(out) = git(".", &[&["config"], scope, &["--get-regexp", r"^includeif\..*\.path$"]].concat()) else {
        return vec![];
    };
    out.lines()
        .filter_map(|line| {
            let (key, file) = line.split_once(' ')?;
            // only the entries this app wrote
            if !file.replace('\\', "/").starts_with(&dir) {
                return None;
            }
            let folder = key.strip_prefix("includeif.gitdir/i:")?.strip_suffix(".path")?;
            let get = |k: &str| git(".", &["config", "-f", file, k]).map(|v| v.trim().to_string()).unwrap_or_default();
            Some(Identity { folder: folder.into(), name: get("user.name"), email: get("user.email") })
        })
        .collect()
}

/// Replaces every identity this app wrote with `list`
fn write_identities(scope: &[&str], dir: &Path, list: &[Identity]) -> Res<()> {
    for old in read_identities(scope, dir) {
        let section = format!("includeIf.gitdir/i:{}", old.folder);
        git(".", &[&["config"], scope, &["--remove-section", &section]].concat())?;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with("identity-") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for (i, id) in list.iter().enumerate() {
        let folder = id.folder.trim().replace('\\', "/");
        if folder.is_empty() {
            continue;
        }
        // trailing slash = every repository below the folder
        let folder = if folder.ends_with('/') { folder } else { format!("{folder}/") };
        let file = dir.join(format!("identity-{i}.gitconfig")).to_string_lossy().replace('\\', "/");
        for (key, value) in [("user.name", id.name.trim()), ("user.email", id.email.trim())] {
            if !value.is_empty() {
                git(".", &["config", "-f", &file, key, value])?;
            }
        }
        let key = format!("includeIf.gitdir/i:{folder}.path");
        git(".", &[&["config"], scope, &[&key, &file]].concat())?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn identities() -> Res<Vec<Identity>> {
    Ok(read_identities(&["--global"], &identity_dir()?))
}

#[tauri::command(async)]
pub fn set_identities(list: Vec<Identity>) -> Res<()> {
    write_identities(&["--global"], &identity_dir()?, &list)
}

/// Starts a program without waiting for it. Windows: a name like "code" may be a
/// .cmd script, which `Command` only finds with the extension (it escapes the
/// arguments safely for .cmd files).
fn spawn(program: &str, args: &[&str], dir: &str, console: bool) -> Res<()> {
    let start = |p: &str| {
        let mut cmd = Command::new(p);
        cmd.args(args).current_dir(dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // a terminal needs its own console window; editors need none
            cmd.creation_flags(if console { 0x0000_0010 } else { 0x0800_0000 });
        }
        #[cfg(not(windows))]
        let _ = console;
        cmd.spawn().map(drop)
    };
    match start(program) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && cfg!(windows) && !program.contains('.') => {
            start(&format!("{program}.cmd")).map_err(|_| format!("{program} não encontrado. Ele está no PATH?"))
        }
        r => r.map_err(|e| format!("Não foi possível abrir {program}: {e}")),
    }
}

/// Opens a file or folder of the repo in the editor chosen in the settings (e.g. "code")
#[tauri::command(async)]
pub fn open_in_editor(repo: String, path: String, editor: String) -> Res<()> {
    let full = Path::new(&repo).join(&path);
    spawn(editor.trim(), &[&full.to_string_lossy()], &repo, false)
}

/// "wt" (Windows Terminal), "powershell", "pwsh", "cmd" or "git-bash", opened in the repo folder
#[tauri::command(async)]
pub fn open_terminal(repo: String, terminal: String) -> Res<()> {
    match terminal.as_str() {
        "wt" => spawn("wt", &["-d", &repo], &repo, false),
        "powershell" | "pwsh" | "cmd" => spawn(&terminal, &[], &repo, true),
        "git-bash" => {
            let bash = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into()) + r"\Git\git-bash.exe";
            spawn(&bash, &[&format!("--cd={repo}")], &repo, false)
        }
        other => Err(format!("Terminal desconhecido: {other}")),
    }
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
pub fn stash_diff(repo: String, name: String, file: String, context: u32, ignore_ws: bool) -> Res<Vec<DiffLine>> {
    let opts = diff_opts(context, ignore_ws);
    let full = git(&repo, &with_opts(&STASH_SHOW, &opts, &["-p", &name]))?;
    Ok(parse::parse_diff(&parse::file_section(&full, &file)))
}

// ---------- Discard backups ----------

/// Hidden ref whose reflog lists every backup (not shown as a branch or stash).
/// Entries expire with git's reflog rules (30 days for these by default).
const DISCARDS: &str = "refs/will-repo/discards";

/// Saves the working tree version of `paths` as a commit on top of HEAD, using a
/// temporary index so the real index (staged changes) is untouched.
/// Commit message: "Descarte: a.txt, b.txt" + one path per line in the body.
fn backup(repo: &str, paths: &[&str]) -> Res<()> {
    let index = git(repo, &["rev-parse", "--git-path", "will-repo-backup-index"])?;
    let index = Path::new(repo).join(index.trim());
    let with_index = |args: &[&str]| check(command(repo, args).env("GIT_INDEX_FILE", &index).output().map_err(|e| e.to_string())?, args);
    let head = git(repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).ok();
    let result = (|| {
        match &head {
            Some(_) => with_index(&["read-tree", "HEAD"])?,
            None => with_index(&["read-tree", "--empty"])?,
        };
        // -A: a deleted file is recorded as absent
        with_index(&[&["add", "-A", "-f", "--"][..], paths].concat())?;
        let tree = with_index(&["write-tree"])?;
        let message = format!("Descarte: {}

{}", paths.join(", "), paths.join("
"));
        let mut args = vec!["commit-tree", tree.trim(), "-m", &message];
        if let Some(h) = &head {
            args.extend(["-p", h.trim()]);
        }
        let hash = git(repo, &args)?;
        git(repo, &["update-ref", "--create-reflog", "-m", &message, DISCARDS, hash.trim()])
    })();
    let _ = std::fs::remove_file(&index);
    result.map(drop)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discard {
    hash: String,
    timestamp: i64,
    files: Vec<String>,
}

/// Backups, newest first
#[tauri::command(async)]
pub fn discard_list(repo: String) -> Res<Vec<Discard>> {
    // no backup yet: the ref doesn't exist
    let Ok(out) = git(&repo, &["log", "-g", "--format=%H%x1f%ct%x1f%b%x1e", DISCARDS, "--"]) else {
        return Ok(vec![]);
    };
    Ok(out
        .split('')
        .filter_map(|rec| {
            let mut f = rec.trim().split(FS);
            Some(Discard {
                hash: f.next().filter(|h| !h.is_empty())?.into(),
                timestamp: f.next()?.parse().unwrap_or(0),
                files: f.next()?.lines().filter(|l| !l.is_empty()).map(String::from).collect(),
            })
        })
        .collect())
}

/// Puts the backed-up files back in the working tree (a file absent from the backup is deleted)
#[tauri::command(async)]
pub fn restore_discard(repo: String, hash: String) -> Res<()> {
    let files = discard_list(repo.clone())?
        .into_iter()
        .find(|d| d.hash == hash)
        .ok_or("Backup não encontrado")?
        .files;
    // current edits of those files would be overwritten: back them up too
    let paths: Vec<&str> = files.iter().map(String::as_str).collect();
    if !git(&repo, &[&["status", "--porcelain", "--"][..], &paths].concat())?.is_empty() {
        backup(&repo, &paths)?;
    }
    for file in &files {
        if git(&repo, &["cat-file", "-e", &format!("{hash}:{file}")]).is_ok() {
            git(&repo, &["restore", "--source", &hash, "--worktree", "--", file])?;
        } else {
            let _ = std::fs::remove_file(Path::new(&repo).join(file));
        }
    }
    Ok(())
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
    context: u32,
) -> Res<()> {
    let (diff_args, apply_args): (&[&str], &[&str]) = match action {
        HunkAction::Stage => (&["diff", "--no-renames"], &["apply", "--cached"]),
        HunkAction::Unstage => (
            &["diff", "--cached", "--no-renames"],
            &["apply", "--cached", "--reverse"],
        ),
        HunkAction::Discard => (&["diff", "--no-renames"], &["apply", "--reverse"]),
    };
    // same -U as the diff the user saw, so hunk numbers and lines match
    let opts = diff_opts(context, false);
    let diff = git(&repo, &with_opts(diff_args, &opts, &["--", &file]))?;
    let patch = match &lines {
        None => parse::hunk_patch(&diff, hunk),
        Some(l) => parse::lines_patch(&diff, hunk, l, !matches!(action, HunkAction::Stage)),
    }
    .ok_or("O trecho mudou, atualize a tela (F5)")?;
    if matches!(action, HunkAction::Discard) {
        backup(&repo, &[&file])?;
    }
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
        assert!(log(r(), 1000, None, vec![]).unwrap().is_empty());

        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        let st = status(r()).unwrap();
        assert_eq!(st.unstaged[0].status, '?');

        stage(r(), vec!["a.txt".into()]).unwrap();
        unstage(r(), vec!["a.txt".into()]).unwrap(); // works without HEAD
        stage(r(), vec!["a.txt".into()]).unwrap();
        commit(r(), "first".into(), false).unwrap();

        create_branch(r(), "feature/x".into(), true, None).unwrap();
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        let d = working_diff(r(), "a.txt".into(), false, false, 3).unwrap();
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

        let commits = log(r(), 1000, None, vec![]).unwrap();
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

        apply_hunk(r(), "long.txt".into(), 1, None, HunkAction::Stage, 3).unwrap();
        let staged = git(&repo, &["diff", "--cached"]).unwrap();
        assert!(staged.contains("+LAST") && !staged.contains("+FIRST"));

        apply_hunk(r(), "long.txt".into(), 0, None, HunkAction::Unstage, 3).unwrap();
        assert!(git(&repo, &["diff", "--cached"]).unwrap().is_empty());

        apply_hunk(r(), "long.txt".into(), 0, None, HunkAction::Discard, 3).unwrap();
        let left = git(&repo, &["diff"]).unwrap();
        assert!(left.contains("+LAST") && !left.contains("+FIRST"));
        assert!(apply_hunk(r(), "long.txt".into(), 5, None, HunkAction::Stage, 3).is_err());

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
            HunkAction::Stage, 3
        )
        .unwrap();
        assert_eq!(git(&repo, &["show", ":pair.txt"]).unwrap(), "X\ny\n");
        // cached body: 0 "-x", 1 "+X"
        apply_hunk(
            r(),
            "pair.txt".into(),
            0,
            Some(vec![0, 1]),
            HunkAction::Unstage, 3
        )
        .unwrap();
        assert_eq!(git(&repo, &["show", ":pair.txt"]).unwrap(), "x\ny\n");
        // discard only "Y" in the working tree: body 0 "-x", 1 "-y", 2 "+X", 3 "+Y"
        apply_hunk(
            r(),
            "pair.txt".into(),
            0,
            Some(vec![1, 3]),
            HunkAction::Discard, 3
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
        let d = stash_diff(r(), "stash@{0}".into(), "long.txt".into(), 3, false).unwrap();
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
        assert_eq!(log(r(), 10, None, vec![]).unwrap()[0].parents.len(), 2);

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

        let commits = log(r(), 10, None, vec![]).unwrap();
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
        let was = delete_branch(r(), "feature".into(), true).unwrap();
        // the returned hash is enough to bring it back (Ctrl+Z)
        restore(r(), was, RestoreAction::Branch, Some("feature".into())).unwrap();
        assert!(refs(r()).unwrap().branches.contains(&"feature".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn amend_pick_revert_tags() {
        let (dir, repo) = temp_repo("pick");
        let r = || repo.clone();

        // amend: message only, then with a staged file
        commit(r(), "base editado".into(), true).unwrap();
        assert_eq!(commit_message(r(), "HEAD".into()).unwrap(), "base editado");
        std::fs::write(dir.join("g.txt"), "g
").unwrap();
        stage(r(), vec!["g.txt".into()]).unwrap();
        commit(r(), "base com g".into(), true).unwrap();
        assert_eq!(log(r(), 10, None, vec![]).unwrap().len(), 1);
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
        assert!(commit_message(r(), "HEAD".into()).unwrap().starts_with("Revert \"add h\""));

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
    fn discard_backup_and_restore() {
        let (dir, repo) = temp_repo("discard");
        let r = || repo.clone();
        let read = |f: &str| std::fs::read_to_string(dir.join(f)).unwrap();
        assert!(discard_list(r()).unwrap().is_empty());

        // modified + staged elsewhere, untracked, deleted: all discarded, then restored
        std::fs::write(dir.join("g.txt"), "g\n").unwrap();
        git(&repo, &["add", "g.txt"]).unwrap();
        git(&repo, &["commit", "-q", "-m", "g"]).unwrap();
        std::fs::write(dir.join("f.txt"), "edited\n").unwrap();
        std::fs::write(dir.join("new.txt"), "novo\n").unwrap();
        std::fs::remove_file(dir.join("g.txt")).unwrap();
        std::fs::write(dir.join("staged.txt"), "s\n").unwrap();
        git(&repo, &["add", "staged.txt"]).unwrap();

        let st = status(r()).unwrap();
        let unstaged: Vec<_> = st.unstaged.into_iter().collect();
        assert_eq!(unstaged.len(), 3);
        discard(r(), unstaged).unwrap();
        assert_eq!(read("f.txt"), "base\n");
        assert!(!dir.join("new.txt").exists());
        assert!(dir.join("g.txt").exists());
        // the real index was not touched
        assert_eq!(status(r()).unwrap().staged[0].path, "staged.txt");

        let list = discard_list(r()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].files, vec!["f.txt", "g.txt", "new.txt"]);
        restore_discard(r(), list[0].hash.clone()).unwrap();
        assert_eq!(read("f.txt"), "edited\n");
        assert_eq!(read("new.txt"), "novo\n");
        assert!(!dir.join("g.txt").exists());

        // hunk discard is backed up too, newest first
        apply_hunk(r(), "f.txt".into(), 0, None, HunkAction::Discard, 3).unwrap();
        assert_eq!(read("f.txt"), "base\n");
        let list = discard_list(r()).unwrap();
        assert_eq!((list.len(), list[0].files.as_slice()), (2, &["f.txt".to_string()][..]));
        restore_discard(r(), list[0].hash.clone()).unwrap();
        assert_eq!(read("f.txt"), "edited\n");
        // restoring over local edits backs them up first
        std::fs::write(dir.join("f.txt"), "local\n").unwrap();
        restore_discard(r(), list[1].hash.clone()).unwrap();
        assert_eq!(discard_list(r()).unwrap().len(), 3);
        assert!(restore_discard(r(), "0000000".into()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discard_backup_without_commits() {
        let dir = std::env::temp_dir().join(format!("will-repo-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, &["init", "-q"]).unwrap();
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        discard(repo.clone(), status(repo.clone()).unwrap().unstaged).unwrap();
        assert!(!dir.join("a.txt").exists());
        restore_discard(repo.clone(), discard_list(repo.clone()).unwrap()[0].hash.clone()).unwrap();
        assert!(dir.join("a.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identities_per_folder() {
        let (dir, repo) = temp_repo("identity");
        let cfg = dir.join("global.gitconfig");
        let cfg_s = cfg.to_string_lossy().into_owned();
        let scope = ["-f", cfg_s.as_str()];
        let ids_dir = dir.join("ids");
        std::fs::write(&cfg, "[user]\n\tname = Global\n").unwrap();

        let work = Identity { folder: repo.clone(), name: "Will Trabalho".into(), email: "will@empresa.com".into() };
        write_identities(&scope, &ids_dir, &[work.clone()]).unwrap();
        let read = read_identities(&scope, &ids_dir);
        assert_eq!(read.len(), 1);
        assert_eq!((read[0].name.as_str(), read[0].email.as_str()), ("Will Trabalho", "will@empresa.com"));
        assert!(read[0].folder.ends_with('/'));

        // git really uses it inside the folder (GIT_CONFIG_GLOBAL = our test file)
        let email = |path: &str| {
            let out = command(path, &["config", "user.email"]).env("GIT_CONFIG_GLOBAL", &cfg).output().unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        // the repo's own config wins over includes, so drop the one temp_repo set
        git(&repo, &["config", "--unset", "user.email"]).unwrap();
        assert_eq!(email(&repo), "will@empresa.com");

        // rewriting replaces ours and keeps the user's own settings
        write_identities(&scope, &ids_dir, &[]).unwrap();
        assert!(read_identities(&scope, &ids_dir).is_empty());
        assert_eq!(email(&repo), "");
        assert!(std::fs::read_to_string(&cfg).unwrap().contains("Global"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn diff_options_and_pull_modes() {
        let (dir, repo) = temp_repo("opts");
        let r = || repo.clone();
        let lines: Vec<String> = (1..=10).map(|n| format!("line {n}")).collect();
        std::fs::write(dir.join("f.txt"), lines.join("\n") + "\n").unwrap();
        git(&repo, &["commit", "-qam", "ten"]).unwrap();
        let mut edited = lines.clone();
        edited[4] = "line  5".into(); // whitespace only
        std::fs::write(dir.join("f.txt"), edited.join("\n") + "\n").unwrap();

        let ctx = |n| working_diff(r(), "f.txt".into(), false, false, n).unwrap().iter().filter(|l| l.kind == parse::DiffKind::Ctx).count();
        assert_eq!((ctx(1), ctx(3)), (2, 6));
        // hunks still apply with a smaller context
        apply_hunk(r(), "f.txt".into(), 0, None, HunkAction::Stage, 1).unwrap();
        git(&repo, &["commit", "-qm", "ws"]).unwrap();
        let head = git(&repo, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        assert!(!commit_diff(r(), head.clone(), "f.txt".into(), 3, false).unwrap().is_empty());
        assert!(commit_diff(r(), head, "f.txt".into(), 3, true).unwrap().iter().all(|l| l.kind != parse::DiffKind::Add));

        // no upstream: every mode fails with git's message, none hangs
        for mode in ["ff-only", "rebase", "merge"] {
            assert!(pull(r(), mode.into()).is_err());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn focus_mode_and_stash_nodes() {
        let (dir, repo) = temp_repo("focus");
        let r = || repo.clone();
        git(&repo, &["switch", "-q", "-c", "feature"]).unwrap();
        std::fs::write(dir.join("g.txt"), "g\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "on feature"]).unwrap();
        git(&repo, &["switch", "-q", "main"]).unwrap();
        std::fs::write(dir.join("f.txt"), "changed\n").unwrap();
        stash_push(r(), "meu stash".into(), false).unwrap();

        let all = log(r(), 100, None, vec![]).unwrap();
        let subjects: Vec<_> = all.iter().map(|c| c.subject.as_str()).collect();
        // the stash is one node (no "index on" commit), above its base
        assert_eq!(subjects.len(), 3);
        let stash = all.iter().find(|c| c.stash.is_some()).unwrap();
        assert_eq!(stash.stash.as_deref(), Some("stash@{0}"));
        assert!(stash.subject.ends_with("meu stash"));
        assert_eq!(all[0].email, "t@t");

        // hide feature: its commit leaves the graph
        let hidden = log(r(), 100, None, vec!["feature".into()]).unwrap();
        assert!(hidden.iter().all(|c| c.subject != "on feature"));
        // solo feature: only its history, no stash
        let solo = log(r(), 100, Some("feature".into()), vec![]).unwrap();
        let subjects: Vec<_> = solo.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, vec!["on feature", "base"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn blob_versions_for_image_diff() {
        let (dir, repo) = temp_repo("blob");
        let png_v1 = [0x89u8, b'P', b'N', b'G', 0, 1, 2, 255];
        std::fs::write(dir.join("img.png"), png_v1).unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "add image"]).unwrap();
        std::fs::write(dir.join("img.png"), [0x89u8, b'P', b'N', b'G', 9]).unwrap();

        // bytes come back untouched (no UTF-8 conversion)
        assert_eq!(blob_bytes(&repo, "HEAD", "img.png").unwrap(), png_v1);
        assert_eq!(blob_bytes(&repo, "INDEX", "img.png").unwrap(), png_v1);
        assert_eq!(blob_bytes(&repo, "WORKTREE", "img.png").unwrap().len(), 5);
        // before the commit the file didn't exist: empty, not an error
        assert!(blob_bytes(&repo, "HEAD^", "img.png").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tree_history_and_blame() {
        let (dir, repo) = temp_repo("blame");
        let r = || repo.clone();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.txt"), "one\ntwo\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "add a"]).unwrap();
        std::fs::write(dir.join("src/a.txt"), "one\nTWO\n").unwrap();
        git(&repo, &["-c", "user.name=Ana", "-c", "user.email=ana@x", "commit", "-qam", "change a"]).unwrap();

        assert_eq!(tree(r(), "HEAD".into()).unwrap(), vec!["f.txt", "src/a.txt"]);
        assert_eq!(tree(r(), "HEAD~2".into()).unwrap(), vec!["f.txt"]);

        let hist: Vec<_> = file_history(r(), "src/a.txt".into(), 50).unwrap().into_iter().map(|c| c.subject).collect();
        assert_eq!(hist, vec!["change a", "add a"]);

        let b = blame(r(), "HEAD".into(), "src/a.txt".into()).unwrap();
        assert_eq!((b[0].text.as_str(), b[0].summary.as_str()), ("one", "add a"));
        assert_eq!((b[1].text.as_str(), b[1].author.as_str(), b[1].email.as_str()), ("TWO", "Ana", "ana@x"));
        // blame of an older version
        assert_eq!(blame(r(), "HEAD~1".into(), "src/a.txt".into()).unwrap()[1].text, "two");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn undo_and_time_machine() {
        let (dir, repo) = temp_repo("undo");
        let r = || repo.clone();
        let head = || git(&repo, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        let base = head();

        // undo a commit: gone, changes staged
        std::fs::write(dir.join("f.txt"), "two\n").unwrap();
        stage(r(), vec!["f.txt".into()]).unwrap();
        commit(r(), "segundo".into(), false).unwrap();
        assert!(undo_preview(r()).unwrap().description.contains("segundo"));
        undo(r()).unwrap();
        assert_eq!(head(), base);
        assert_eq!(status(r()).unwrap().staged[0].path, "f.txt");
        commit(r(), "segundo".into(), false).unwrap();
        let second = head();

        // undo a checkout: back to the branch
        create_branch(r(), "feature".into(), true, None).unwrap();
        assert_eq!(undo_preview(r()).unwrap().description, "Voltar para a branch main");
        undo(r()).unwrap();
        assert_eq!(refs(r()).unwrap().head.as_deref(), Some("main"));

        // undo a reset: the "lost" commit comes back
        git(&repo, &["reset", "-q", "--hard", &base]).unwrap();
        undo(r()).unwrap();
        assert_eq!(head(), second);

        // time machine: entries newest first, branch from an old position
        let entries = reflog(r(), 50).unwrap();
        assert_eq!(entries[0].action, "reset");
        assert!(entries.iter().any(|e| e.action == "checkout" && e.message == "moving from main to feature"));
        restore(r(), base.clone(), RestoreAction::Branch, Some("resgate".into())).unwrap();
        assert!(refs(r()).unwrap().branches.contains(&"resgate".to_string()));
        restore(r(), base.clone(), RestoreAction::Reset, None).unwrap();
        assert_eq!(head(), base);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn branch_templates_start_and_finish() {
        let (dir, repo) = temp_repo("flow");
        let r = || repo.clone();
        assert_eq!(default_branch(r()).unwrap(), "main");
        git(&repo, &["switch", "-q", "-c", "other"]).unwrap();
        std::fs::write(dir.join("o.txt"), "o\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "on other"]).unwrap();

        // start from main even while on another branch
        create_branch(r(), "feature/login".into(), true, Some("main".into())).unwrap();
        assert!(!dir.join("o.txt").exists());
        std::fs::write(dir.join("login.txt"), "l\n").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(&repo, &["commit", "-qm", "login"]).unwrap();

        finish_branch(r(), "feature/login".into(), "main".into(), Some("v1.0".into())).unwrap();
        let rf = refs(r()).unwrap();
        assert_eq!(rf.head.as_deref(), Some("main"));
        assert!(!rf.branches.contains(&"feature/login".to_string()));
        assert_eq!(rf.tags, vec!["v1.0"]);
        let top = &log(r(), 5, None, vec![]).unwrap()[0];
        assert_eq!(top.parents.len(), 2); // --no-ff merge commit
        assert!(dir.join("login.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn submodules_worktrees_and_lfs() {
        let (dir, repo) = temp_repo("struct");
        let r = || repo.clone();
        let (lib_dir, lib) = temp_repo("struct-lib");

        // submodule from a local folder (file:// needs to be allowed explicitly)
        git(&repo, &["-c", "protocol.file.allow=always", "submodule", "add", "-q", &lib, "libs/lib"]).unwrap();
        git(&repo, &["commit", "-qm", "add submodule"]).unwrap();
        let subs = submodules(r()).unwrap();
        assert_eq!((subs[0].path.as_str(), subs[0].state), ("libs/lib", "ok"));
        assert!(subs[0].abs_path.ends_with("libs/lib"));
        assert_eq!(parse_submodules(&repo, &format!("-{} x/y", "a".repeat(40)))[0].state, "uninitialized");

        // worktree with a new branch in a sibling folder, then remove it
        let wt = dir.with_file_name(format!("{}-wt", dir.file_name().unwrap().to_string_lossy()));
        let wt_s = wt.to_string_lossy().into_owned();
        worktree_add(r(), wt_s.clone(), "outra".into(), true).unwrap();
        let list = worktrees(r()).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].main && list[0].branch.as_deref() == Some("main"));
        assert_eq!(list[1].branch.as_deref(), Some("outra"));
        assert!(wt.join("f.txt").exists());
        worktree_remove(r(), wt_s, false).unwrap();
        assert_eq!(worktrees(r()).unwrap().len(), 1);

        // LFS (skipped when git-lfs isn't installed)
        if lfs_status(r()).unwrap().installed {
            git(&repo, &["lfs", "install", "--local"]).unwrap();
            lfs_track(r(), "*.psd".into(), true).unwrap();
            std::fs::write(dir.join("arte.psd"), [0u8, 1, 2, 3]).unwrap();
            git(&repo, &["add", "."]).unwrap();
            git(&repo, &["commit", "-qm", "lfs"]).unwrap();
            let st = lfs_status(r()).unwrap();
            assert_eq!(st.patterns, vec!["*.psd"]);
            assert_eq!(st.files, vec!["arte.psd"]);
            lfs_track(r(), "*.psd".into(), false).unwrap();
            assert!(lfs_status(r()).unwrap().patterns.is_empty());
        }
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&lib_dir);
    }

    #[test]
    fn clone_a_local_repository() {
        let (dir, repo) = temp_repo("clone-src");
        let dest = dir.with_file_name(format!("{}-copia", dir.file_name().unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dest);
        let info = clone_repo(repo.clone(), dest.to_string_lossy().into_owned()).unwrap();
        assert!(info.name.ends_with("-copia"));
        assert!(dest.join("f.txt").exists());
        // cloning again into the same folder is refused before running git
        assert!(clone_repo(repo, dest.to_string_lossy().into_owned()).unwrap_err().contains("já existe"));
        let _ = std::fs::remove_dir_all(&dest);
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
