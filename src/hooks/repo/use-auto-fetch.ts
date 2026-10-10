import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { RepoApi } from "@/hooks/use-repo";
import { useSettings } from "@/hooks/use-settings";
import { git } from "@/lib/git";

/**
 * Background fetch every few minutes (Settings > Git); warns when the current branch
 * got new commits on the remote. Only the open tab is mounted, so only it fetches
 * (like a TTimer on the active form).
 */
export function useAutoFetch({ repo, data, busy, run, reload }: Pick<RepoApi, "repo" | "data" | "busy" | "run" | "reload">) {
  const { autoFetchMinutes } = useSettings();
  const path = repo?.path;
  // the interval callback reads `latest`, because its closure would keep old state
  const latest = useRef({ busy, behind: 0 });
  latest.current = { busy, behind: data?.tracking.behind ?? 0 };

  useEffect(() => {
    if (!autoFetchMinutes || !path) return; // turned off in the settings
    const id = setInterval(async () => {
      if (latest.current.busy || document.hidden) return;
      const before = latest.current.behind;
      try {
        await git.fetch(path, true);
      } catch {
        return; // offline or no remote: try again next time, no error toast every 5 minutes
      }
      await reload();
      const t = await git.tracking(path).catch(() => null);
      if (t && t.behind > before)
        toast.info(`${t.behind - before} commit(s) novo(s) em ${t.upstream}`, {
          duration: 15000,
          action: { label: "Pull", onClick: () => run("pull", git.pull, "Pull concluído") },
        });
    }, autoFetchMinutes * 60_000);
    return () => clearInterval(id);
  }, [path, reload, run, autoFetchMinutes]);
}
