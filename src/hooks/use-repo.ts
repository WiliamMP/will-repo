import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { git, type Commit, type Refs, type RepoInfo, type Status, type Tracking } from "@/lib/git";

const KEY = "will-repo.lastRepo";

type Data = { commits: Commit[]; refs: Refs; status: Status; tracking: Tracking };

// All repository state in one place (like a TDataModule shared by the forms)
export function useRepo() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async (path: string) => {
    try {
      const [commits, refs, status, tracking] = await Promise.all([
        git.log(path),
        git.refs(path),
        git.status(path),
        git.tracking(path),
      ]);
      setData({ commits, refs, status, tracking });
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  const open = useCallback(
    async (path: string) => {
      try {
        const info = await git.openRepo(path);
        setRepo(info);
        setData(null);
        localStorage.setItem(KEY, info.path);
        await reload(info.path);
      } catch (e) {
        toast.error(String(e));
      }
    },
    [reload],
  );

  // Reopen the last repository on startup
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(KEY);
    } catch {}
    if (last) open(last);
  }, [open]);

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
        await reload(repo.path);
      }
    },
    [repo, reload],
  );

  return { repo, data, busy, open, run, reload: () => repo && reload(repo.path) };
}
