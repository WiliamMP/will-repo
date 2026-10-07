// Typed wrappers around the Rust commands in src-tauri/src/git.rs.
// invoke() ≈ calling a function in a DLL: name + params in, JSON out.
import { invoke } from "@tauri-apps/api/core";

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
export type Status = { staged: FileChange[]; unstaged: FileChange[] };
export type Tracking = { upstream: string | null; ahead: number; behind: number };
export type RepoInfo = { path: string; name: string };

export type DiffLine = {
  kind: "hunk" | "ctx" | "add" | "del" | "info";
  old: number | null;
  new: number | null;
  text: string;
};

export const git = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  log: (repo: string) => invoke<Commit[]>("log", { repo }),
  refs: (repo: string) => invoke<Refs>("refs", { repo }),
  status: (repo: string) => invoke<Status>("status", { repo }),
  tracking: (repo: string) => invoke<Tracking>("tracking", { repo }),
  commitFiles: (repo: string, hash: string) => invoke<FileChange[]>("commit_files", { repo, hash }),
  commitDiff: (repo: string, hash: string, file: string) => invoke<DiffLine[]>("commit_diff", { repo, hash, file }),
  workingDiff: (repo: string, file: FileChange, staged: boolean) =>
    invoke<DiffLine[]>("working_diff", { repo, file: file.path, staged, untracked: file.status === "?" }),
  stage: (repo: string, files: string[]) => invoke<void>("stage", { repo, files }),
  unstage: (repo: string, files: string[]) => invoke<void>("unstage", { repo, files }),
  discard: (repo: string, files: FileChange[]) => invoke<void>("discard", { repo, files }),
  commit: (repo: string, message: string) => invoke<void>("commit", { repo, message }),
  fetch: (repo: string) => invoke<void>("fetch", { repo }),
  pull: (repo: string) => invoke<void>("pull", { repo }),
  push: (repo: string) => invoke<void>("push", { repo }),
  checkout: (repo: string, branch: string, remote: boolean) => invoke<void>("checkout", { repo, branch, remote }),
  createBranch: (repo: string, name: string, checkout: boolean) => invoke<void>("create_branch", { repo, name, checkout }),
};

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
