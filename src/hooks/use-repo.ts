import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  git,
  type Commit,
  type Focus,
  type Refs,
  type RepoInfo,
  type RepoState,
  type Stash,
  type Status,
  type Submodule,
  type Worktree,
  type Tracking,
} from "@/lib/git";

type Data = {
  commits: Commit[];
  refs: Refs;
  status: Status;
  tracking: Tracking;
  stashes: Stash[];
  state: RepoState;
  submodules: Submodule[];
  worktrees: Worktree[];
  /** true when the log hit the limit, so older commits exist */
  hasMore: boolean;
};

const PAGE = 1000;

// All state of one open repository (like a TDataModule shared by the forms).
// Each tab mounts its own copy.
export function useRepo(path: string) {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const limit = useRef(PAGE);
  // focus mode is remembered per repository
  const focusKey = `will-repo.focus:${path}`;
  const [focus, setFocusState] = useState<Focus>(() => {
    try {
      return { solo: null, hidden: [], ...JSON.parse(localStorage.getItem(focusKey) ?? "{}") };
    } catch {
      return { solo: null, hidden: [] };
    }
  });
  const setFocus = useCallback(
    (f: Focus) => {
      setFocusState(f);
      try {
        localStorage.setItem(focusKey, JSON.stringify(f));
      } catch {}
    },
    [focusKey],
  );

  const reload = useCallback(async () => {
    if (!repo) return;
    try {
      const p = repo.path;
      const [commits, refs, status, tracking, stashes, state, submodules, worktrees] = await Promise.all([
        git.log(p, limit.current, focus),
        git.refs(p),
        git.status(p),
        git.tracking(p),
        git.stashList(p),
        git.state(p),
        // extras: a failure here must not hide the whole repository
        git.submodules(p).catch(() => []),
        git.worktrees(p).catch(() => []),
      ]);
      setData({ commits, refs, status, tracking, stashes, state, submodules, worktrees, hasMore: commits.length >= limit.current });
    } catch (e) {
      toast.error(String(e));
    }
  }, [repo, focus]);

  useEffect(() => {
    git.openRepo(path).then(setRepo, (e) => setError(String(e)));
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadMore = useCallback(() => {
    limit.current += PAGE;
    return reload();
  }, [reload]);

  /** Runs a git action with a busy flag, a toast on error, and a reload after */
  const run = useCallback(
    async (label: string, action: (path: string) => Promise<unknown>, success?: string) => {
      if (!repo) return false;
      setBusy(label);
      try {
        await action(repo.path);
        if (success) toast.success(success);
        return true;
      } catch (e) {
        toast.error(String(e));
        return false;
      } finally {
        setBusy(null);
        await reload();
      }
    },
    [repo, reload],
  );

  return { repo, data, busy, error, run, reload, loadMore, focus, setFocus };
}

export type RepoApi = ReturnType<typeof useRepo>;
