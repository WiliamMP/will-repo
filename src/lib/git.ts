// Typed wrappers around the Rust commands in src-tauri/src/git.rs.
// invoke() ≈ calling a function in a DLL: name + params in, JSON out.
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { getSettings } from "@/hooks/use-settings";

export type RefKind = "head" | "branch" | "remote" | "tag";
export type RefLabel = { name: string; kind: RefKind };

export type Commit = {
  hash: string;
  parents: string[];
  author: string;
  timestamp: number; // unix seconds
  refs: RefLabel[];
  subject: string;
  lane: number;
};

export type Refs = { head: string | null; branches: string[]; remotes: string[]; tags: string[] };

export type FileChange = { path: string; status: string; add: number; del: number };
export type Status = { staged: FileChange[]; unstaged: FileChange[]; conflicted: FileChange[] };
export type Tracking = { upstream: string | null; ahead: number; behind: number };
export type RepoInfo = { path: string; name: string };
export type Stash = { name: string; message: string; timestamp: number };
export type Discard = { hash: string; timestamp: number; files: string[] };
export type StashAction ="apply" | "pop" | "drop";
export type HunkAction = "stage" | "unstage" | "discard";
export type Choice = "ours" | "theirs" | "both";
export type OpAction = "continue" | "abort" | "skip";
export type RepoState = {
  kind: "merge" | "rebase" | "cherry-pick" | "revert" | null;
  label: string;
  step: string | null;
};

export type UserInfo = { name: string | null; email: string | null };
/** name/email used for every repository inside `folder` */
export type Identity = { folder: string; name: string; email: string };
export type RepoSummary = {
  path: string;
  name: string;
  head: string | null;
  lastCommit: { subject: string; author: string; timestamp: number } | null;
  totalCommits: number;
  changes: number;
  ahead: number;
  behind: number;
  /** unix times of the user's commits in the last year */
  myCommits: number[];
};

export type GithubProfile = {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  url: string;
  followers: number;
  following: number;
  repositories: number;
  totalContributions: number;
  /** [date "YYYY-MM-DD", count] for every day of the last year */
  days: [string, number][];
  source: "app" | "gh";
};
export type PullRequest = {
  number: number;
  title: string;
  url: string;
  author: string;
  head: string;
  base: string;
  draft: boolean;
  updatedAt: string;
  review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** CI of the last commit; null when the repo has no checks */
  ci: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null;
};
export type PullRequests = { defaultBranch: string; items: PullRequest[] };
export type DeviceCode = { deviceCode: string; userCode: string; verificationUri: string; interval: number };

export type DiffLine = {
  kind: "hunk" | "ctx" | "add" | "del" | "info" | "marker" | "ours" | "base" | "theirs";
  old: number | null;
  new: number | null;
  text: string;
};

export const git = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  /** "git version 2.x"; fails when git is not installed */
  version: () => invoke<string>("git_version"),
  userInfo: () => invoke<UserInfo>("user_info"),
  setUserInfo: (name: string, email: string) => invoke<void>("set_user_info", { name, email }),
  identities: () => invoke<Identity[]>("identities"),
  setIdentities: (list: Identity[]) => invoke<void>("set_identities", { list }),
  /** `path` relative to the repo ("" = the repo folder) */
  openInEditor: (repo: string, path: string) =>
    invoke<void>("open_in_editor", { repo, path, editor: getSettings().editor }),
  openTerminal: (repo: string) => invoke<void>("open_terminal", { repo, terminal: getSettings().terminal }),
  githubProfile: () => invoke<GithubProfile>("github_profile"),
  githubDeviceStart: () => invoke<DeviceCode>("github_device_start"),
  githubDevicePoll: (deviceCode: string) => invoke<"pending" | "slow_down" | "done">("github_device_poll", { deviceCode }),
  githubLogout: () => invoke<void>("github_logout"),
  githubPrs: (repo: string) => invoke<PullRequests>("github_prs", { repo }),
  /** returns the new PR's URL */
  githubCreatePr: (repo: string, title: string, body: string, base: string, draft: boolean) =>
    invoke<string>("github_create_pr", { repo, title, body, base, draft }),
  repoSummary: (repo: string, email: string | null) => invoke<RepoSummary>("repo_summary", { repo, email }),
  log: (repo: string, limit: number) => invoke<Commit[]>("log", { repo, limit }),
  search: (repo: string, query: string) => invoke<Commit[]>("search", { repo, query }),
  refs: (repo: string) => invoke<Refs>("refs", { repo }),
  status: (repo: string) => invoke<Status>("status", { repo }),
  tracking: (repo: string) => invoke<Tracking>("tracking", { repo }),
  state: (repo: string) => invoke<RepoState>("repo_state", { repo }),
  commitFiles: (repo: string, hash: string) => invoke<FileChange[]>("commit_files", { repo, hash }),
  commitDiff: (repo: string, hash: string, file: string) =>
    invoke<DiffLine[]>("commit_diff", { repo, hash, file, ...readOnlyDiff() }),
  workingDiff: (repo: string, file: FileChange, staged: boolean) =>
    invoke<DiffLine[]>("working_diff", {
      repo,
      file: file.path,
      staged,
      untracked: file.status === "?",
      context: getSettings().diffContext,
    }),
  stage: (repo: string, files: string[]) => invoke<void>("stage", { repo, files }),
  unstage: (repo: string, files: string[]) => invoke<void>("unstage", { repo, files }),
  discard: (repo: string, files: FileChange[]) => invoke<void>("discard", { repo, files }),
  /** backups saved before each discard, newest first */
  discardList: (repo: string) => invoke<Discard[]>("discard_list", { repo }),
  restoreDiscard: (repo: string, hash: string) => invoke<void>("restore_discard", { repo, hash }),
  commit: (repo: string, message: string, amend: boolean) => invoke<void>("commit", { repo, message, amend }),
  headMessage: (repo: string) => invoke<string>("commit_message", { repo, rev: "HEAD" }),
  commitMessage: (repo: string, hash: string) => invoke<string>("commit_message", { repo, rev: hash }),
  /** "https://github.com/owner/name", or null when origin isn't on GitHub */
  githubUrl: (repo: string) => invoke<string | null>("github_url", { repo }),
  /** cherry-pick onto HEAD, or revert (new commit that undoes it) */
  pick: (repo: string, hash: string, revert: boolean) => invoke<void>("pick", { repo, hash, revert }),
  createTag: (repo: string, name: string, hash: string, message: string) =>
    invoke<void>("create_tag", { repo, name, hash, message }),
  deleteTag: (repo: string, name: string) => invoke<void>("delete_tag", { repo, name }),
  pushTag: (repo: string, name: string) => invoke<void>("push_tag", { repo, name }),
  /** background: never opens a login window (auto fetch) */
  fetch: (repo: string, background: boolean) => invoke<void>("fetch", { repo, background }),
  pull: (repo: string) => invoke<void>("pull", { repo, mode: getSettings().pullMode }),
  push: (repo: string) => invoke<void>("push", { repo }),
  checkout: (repo: string, branch: string, remote: boolean) => invoke<void>("checkout", { repo, branch, remote }),
  createBranch: (repo: string, name: string, checkout: boolean) => invoke<void>("create_branch", { repo, name, checkout }),
  deleteBranch: (repo: string, name: string, force: boolean) => invoke<void>("delete_branch", { repo, name, force }),
  merge: (repo: string, branch: string) => invoke<void>("merge", { repo, branch }),
  rebase: (repo: string, onto: string) => invoke<void>("rebase", { repo, onto }),
  operation: (repo: string, action: OpAction) => invoke<void>("operation", { repo, action }),
  conflictView: (repo: string, file: string) => invoke<DiffLine[]>("conflict_view", { repo, file }),
  resolveBlock: (repo: string, file: string, block: number, choice: Choice) =>
    invoke<void>("resolve_conflict_block", { repo, file, block, choice }),
  resolveFile: (repo: string, file: string, choice: Choice) => invoke<void>("resolve_file", { repo, file, choice }),
  stashList: (repo: string) => invoke<Stash[]>("stash_list", { repo }),
  stashPush: (repo: string, message: string, untracked: boolean) => invoke<void>("stash_push", { repo, message, untracked }),
  stashAction: (repo: string, name: string, action: StashAction) => invoke<void>("stash_action", { repo, name, action }),
  stashFiles: (repo: string, name: string) => invoke<FileChange[]>("stash_files", { repo, name }),
  stashDiff: (repo: string, name: string, file: string) =>
    invoke<DiffLine[]>("stash_diff", { repo, name, file, ...readOnlyDiff() }),
  /** `lines` = body line indexes inside the hunk; omit to apply the whole hunk */
  applyHunk: (repo: string, file: string, hunk: number, action: HunkAction, lines?: number[]) =>
    invoke<void>("apply_hunk", { repo, file, hunk, action, lines: lines ?? null, context: getSettings().diffContext }),
};

/** diff options for history/stash diffs (they are never applied back, so whitespace can be ignored) */
function readOnlyDiff() {
  const s = getSettings();
  return { context: s.diffContext, ignoreWs: s.ignoreWhitespace };
}

/** Opens a repo file ("" = the folder) in the editor from the settings, or with the default app */
export function openInEditor(repo: string, path: string) {
  const open = getSettings().editor.trim()
    ? git.openInEditor(repo, path)
    : openPath(path ? `${repo}/${path}` : repo);
  return open.catch((e) => toast.error(String(e)));
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/// "há 5 minutos", "ontem", or a date for older commits
export function relativeDate(unix: number) {
  const diff = unix - Date.now() / 1000;
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(unix * 1000).toLocaleDateString("pt-BR");
}
