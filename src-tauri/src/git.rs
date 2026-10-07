// Tauri commands: each one runs the git CLI and returns parsed data to React.
// `#[tauri::command(async)]` runs the function on a worker thread,
// so a slow push doesn't freeze the window (like TThread in Delphi).

use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;

use crate::parse::{self, Commit, DiffLine, FileChange, Refs, Status, FS, RS};

type Res<T> = Result<T, String>;

fn run(repo: &str, args: &[&str]) -> Res<Output> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["-c", "core.quotePath=false", "-c", "color.ui=false"])
        .args(args)
        // never wait for a username/password on stdin; the Git Credential Manager window still works
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console flashing on every git call
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output().map_err(|e| format!("Não foi possível executar o git: {e}"))
}

/// Runs git and returns stdout, or stderr as the error message
fn git(repo: &str, args: &[&str]) -> Res<String> {
    let out = run(repo, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { format!("git {} falhou", args.join(" ")) } else { err })
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
    let name = Path::new(&root).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(RepoInfo { path: root, name })
}

// ponytail: fixed limit of 1000 commits, add paging if big repos need older history
#[tauri::command(async)]
pub fn log(repo: String) -> Res<Vec<Commit>> {
    let format = format!("--format=%H{FS}%P{FS}%an{FS}%at{FS}%D{FS}%s{RS}");
    let out = git(&repo, &["log", "--all", "--date-order", "--decorate=full", "-n", "1000", &format])?;
    let mut commits = parse::parse_log(&out);
    parse::assign_lanes(&mut commits);
    Ok(commits)
}

#[tauri::command(async)]
pub fn refs(repo: String) -> Res<Refs> {
    let out = git(&repo, &["for-each-ref", "--format=%(refname)%00%(HEAD)", "refs/heads", "refs/remotes", "refs/tags"])?;
    Ok(parse::parse_refs(&out))
}

#[tauri::command(async)]
pub fn status(repo: String) -> Res<Status> {
    let out = git(&repo, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
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
        return Ok(Tracking { upstream: None, ahead: 0, behind: 0 });
    };
    let counts = git(&repo, &["rev-list", "--left-right", "--count", "HEAD...@{u}"])?;
    let mut n = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
    Ok(Tracking {
        upstream: Some(upstream.trim().to_string()),
        ahead: n.next().unwrap_or(0),
        behind: n.next().unwrap_or(0),
    })
}

// Merge commits are compared against their first parent (what SourceTree shows by default)
const SHOW: [&str; 4] = ["show", "--format=", "--diff-merges=first-parent", "--no-renames"];

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
pub fn working_diff(repo: String, file: String, staged: bool, untracked: bool) -> Res<Vec<DiffLine>> {
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
    let args: Vec<&str> = ["add", "--"].into_iter().chain(files.iter().map(String::as_str)).collect();
    git(&repo, &args).map(drop)
}

#[tauri::command(async)]
pub fn unstage(repo: String, files: Vec<String>) -> Res<()> {
    let has_head = git(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok();
    // `restore --staged` needs a HEAD; in a repo without commits, remove from the index instead
    let base: &[&str] = if has_head { &["restore", "--staged", "--"] } else { &["rm", "--cached", "-q", "--"] };
    let args: Vec<&str> = base.iter().copied().chain(files.iter().map(String::as_str)).collect();
    git(&repo, &args).map(drop)
}

/// Throws away working tree changes. Untracked files are deleted.
#[tauri::command(async)]
pub fn discard(repo: String, files: Vec<FileChange>) -> Res<()> {
    let (untracked, tracked): (Vec<_>, Vec<_>) = files.iter().partition(|f| f.status == '?');
    if !tracked.is_empty() {
        let args: Vec<&str> = ["restore", "--"].into_iter().chain(tracked.iter().map(|f| f.path.as_str())).collect();
        git(&repo, &args)?;
    }
    if !untracked.is_empty() {
        let args: Vec<&str> = ["clean", "-f", "--"].into_iter().chain(untracked.iter().map(|f| f.path.as_str())).collect();
        git(&repo, &args)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn commit(repo: String, message: String) -> Res<()> {
    git(&repo, &["commit", "-m", &message]).map(drop)
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
        assert!(log(r()).unwrap().is_empty());

        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        let st = status(r()).unwrap();
        assert_eq!(st.unstaged[0].status, '?');

        stage(r(), vec!["a.txt".into()]).unwrap();
        unstage(r(), vec!["a.txt".into()]).unwrap(); // works without HEAD
        stage(r(), vec!["a.txt".into()]).unwrap();
        commit(r(), "first".into()).unwrap();

        create_branch(r(), "feature/x".into(), true).unwrap();
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        let d = working_diff(r(), "a.txt".into(), false, false).unwrap();
        assert!(d.iter().any(|l| l.kind == parse::DiffKind::Add && l.text == "two"));
        stage(r(), vec!["a.txt".into()]).unwrap();
        commit(r(), "second".into()).unwrap();

        checkout(r(), "main".into(), false).unwrap();
        git(&repo, &["merge", "--no-ff", "-q", "-m", "merge", "feature/x"]).unwrap();

        let commits = log(r()).unwrap();
        let subjects: Vec<_> = commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, vec!["merge", "second", "first"]);
        assert_eq!(commits[0].parents.len(), 2);

        let files = commit_files(r(), commits[1].hash.clone()).unwrap();
        assert_eq!((files[0].path.as_str(), files[0].add, files[0].del), ("a.txt", 1, 0));
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

        let _ = std::fs::remove_dir_all(&dir);
    }
}
