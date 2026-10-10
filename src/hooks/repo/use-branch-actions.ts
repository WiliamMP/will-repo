import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BranchActions } from "@/components/Sidebar";
import type { StructureActions } from "@/components/RepoStructure";
import type { CommitActions } from "@/components/History";
import type { RepoApi } from "@/hooks/use-repo";
import type { Panels } from "@/hooks/repo/use-panels";
import { useSettings } from "@/hooks/use-settings";
import { confirm } from "@/lib/confirm";
import { git } from "@/lib/git";

type Deps = {
  api: RepoApi;
  panels: Panels;
  undo: { undoLast: () => void; rememberDeleted: (name: string, hash: string) => void };
  /** opens another repository (submodule, worktree) in a new tab */
  onOpenRepo: (path: string) => void;
};

/**
 * What the sidebar, the history and the structure sections can do: checkout, merge,
 * rebase, delete and finish branches, tags, focus mode, cherry-pick/revert,
 * submodules and worktrees. Every git call goes through `run` (busy flag, toast, reload).
 */
export function useBranchActions({ api, panels, undo, onOpenRepo }: Deps) {
  const { repo, data, run, reload, focus, setFocus } = api;
  const path = repo?.path ?? "";
  const head = data?.refs.head ?? "HEAD";
  const { branchTemplates } = useSettings();
  const [defaultBase, setDefaultBase] = useState("main");
  useEffect(() => {
    if (path) git.defaultBranch(path).then(setDefaultBase, () => {});
  }, [path]);

  const branch: BranchActions = {
    checkout: (name, remote) => run("checkout", (p) => git.checkout(p, name, remote), `Checkout em ${name}`),
    merge: (name) => run("merge", (p) => git.merge(p, name), `${name} mesclada em ${head}`),
    rebase: async (name) => {
      const ok = await confirm(
        `Reaplicar os commits de ${head} sobre ${name}?\n\nIsso reescreve o histórico de ${head}. Se ${head} já foi enviada (push), vai precisar de push forçado.`,
        "Rebase",
        "Fazer rebase",
      );
      if (ok) run("rebase", (p) => git.rebase(p, name), `Rebase de ${head} sobre ${name} concluído`);
    },
    remove: async (name) => {
      if (!(await confirm(`Excluir a branch ${name}? Dá para desfazer com Ctrl+Z.`, "Excluir branch", "Excluir"))) return;
      try {
        undo.rememberDeleted(name, await git.deleteBranch(path, name, false));
        toast.success(`Branch ${name} excluída`, { action: { label: "Desfazer", onClick: () => undo.undoLast() } });
      } catch (e) {
        // -d refuses unmerged branches: offer force delete
        const force = await confirm(
          `${name} tem commits que não estão em nenhuma outra branch. Excluir mesmo assim? Esses commits podem ser perdidos.\n\n${e}`,
          "Branch não mesclada",
          "Excluir à força",
        );
        if (!force) return;
        await run("branch", async (p) => undo.rememberDeleted(name, await git.deleteBranch(p, name, true)), `Branch ${name} excluída (Ctrl+Z desfaz)`);
      }
      reload();
    },
    finish: async (name) => {
      const t = branchTemplates.find((x) => name.startsWith(x.prefix));
      if (!t) return;
      const base = t.base || defaultBase;
      const rest = name.slice(t.prefix.length);
      // release/1.2 -> tag v1.2 (a version number gets the usual "v")
      const tag = t.tag ? (/^\d/.test(rest) ? `v${rest}` : rest) : null;
      const ok = await confirm(
        `Finalizar ${name}?\n\n• Mesclar em ${base} com um commit de merge\n${tag ? `• Criar a tag ${tag}\n` : ""}• Excluir ${name}`,
        "Finalizar branch",
        "Finalizar",
      );
      if (ok) run("finalizar", (p) => git.finishBranch(p, name, base, tag), `${name} finalizada em ${base}`);
    },
    drop: (source, target, x, y) => panels.setDropMenu({ source, target, x, y }),
    solo: (name) => setFocus({ solo: name, hidden: [] }),
    toggleHidden: (name) =>
      setFocus({
        solo: null,
        hidden: focus.hidden.includes(name) ? focus.hidden.filter((h) => h !== name) : [...focus.hidden, name],
      }),
    pushTag: (name) => run("push", (p) => git.pushTag(p, name), `Tag ${name} enviada`),
    deleteTag: async (name) => {
      if (await confirm(`Excluir a tag ${name}? Se já foi enviada, ela continua no remote.`, "Excluir tag", "Excluir"))
        run("tag", (p) => git.deleteTag(p, name), `Tag ${name} excluída`);
    },
  };

  const structure: StructureActions = {
    openTab: onOpenRepo,
    updateSubmodules: (sub) => run("submódulos", (p) => git.submoduleUpdate(p, sub), sub ? `${sub} atualizado` : "Submódulos atualizados"),
    addWorktree: () => panels.setWorktreeOpen(true),
    removeWorktree: async (w) => {
      if (!(await confirm(`Remover a pasta ${w.path}? A branch ${w.branch ?? ""} continua existindo.`, "Remover worktree", "Remover"))) return;
      try {
        await git.worktreeRemove(path, w.path, false);
      } catch (e) {
        // uncommitted changes there: offer to discard them
        if (!(await confirm(`${e}\n\nRemover mesmo assim? As alterações não commitadas nessa pasta serão perdidas.`, "Worktree com alterações", "Remover à força"))) return;
        await git.worktreeRemove(path, w.path, true).catch((err) => toast.error(String(err)));
      }
      reload();
    },
    openLfs: () => panels.setLfsOpen(true),
  };

  // Conflicts leave the operation in progress: the banner and the changes tab take over
  const commit: CommitActions = {
    cherryPick: (c) => run("cherry-pick", (p) => git.pick(p, c.hash, false), `${c.hash.slice(0, 7)} aplicado em ${head}`),
    revert: (c) => run("revert", (p) => git.pick(p, c.hash, true), `${c.hash.slice(0, 7)} revertido`),
    tag: panels.setTagTarget,
    browse: (c) => panels.setBrowser({ rev: c.hash }),
  };

  return { branch, structure, commit, defaultBase };
}
