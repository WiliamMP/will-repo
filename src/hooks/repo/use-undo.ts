import { useRef } from "react";
import { toast } from "sonner";
import type { RepoApi } from "@/hooks/use-repo";
import { confirm } from "@/lib/confirm";
import { git } from "@/lib/git";

/**
 * Ctrl+Z for git: undoes the last move of HEAD (from the reflog), or recreates the
 * branch deleted last. Deleting a branch doesn't move HEAD, so the reflog can't
 * undo it: the app remembers the name and the commit it pointed to.
 */
export function useUndo(path: string, run: RepoApi["run"]) {
  const deleted = useRef<{ name: string; hash: string; at: number } | null>(null);

  const undoLast = async () => {
    const d = deleted.current;
    const latest = (await git.reflog(path, 1).catch(() => []))[0];
    if (d && (!latest || d.at >= latest.timestamp)) {
      if (!(await confirm(`Recriar a branch ${d.name}, excluída há pouco?`, "Desfazer", "Recriar"))) return;
      if (await run("desfazer", (p) => git.restore(p, d.hash, "branch", d.name), `Branch ${d.name} recriada`)) deleted.current = null;
      return;
    }
    try {
      const plan = await git.undoPreview(path);
      if (await confirm(plan.description, "Desfazer", "Desfazer")) run("desfazer", (p) => git.undo(p), "Desfeito");
    } catch (e) {
      toast.info(String(e));
    }
  };

  /** call right after deleting a branch, with the commit it pointed to */
  const rememberDeleted = (name: string, hash: string) => {
    deleted.current = { name, hash, at: Date.now() / 1000 };
  };

  return { undoLast, rememberDeleted };
}
