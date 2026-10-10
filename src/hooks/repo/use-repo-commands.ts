import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Cloud,
  Code2,
  FileText,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  History as HistoryIcon,
  LogIn,
  Play,
  RefreshCw,
  Search,
  SquareTerminal,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { BranchActions } from "@/components/Sidebar";
import type { StructureActions } from "@/components/RepoStructure";
import type { RepoApi } from "@/hooks/use-repo";
import type { Panels } from "@/hooks/repo/use-panels";
import { useCommands, type Command } from "@/lib/commands";
import { git, openInEditor } from "@/lib/git";

type Deps = {
  api: RepoApi;
  panels: Panels;
  sync: { fetch: () => void; pull: () => void; push: () => void };
  undoLast: () => void;
  branch: BranchActions;
  structure: StructureActions;
};

/** Registers this repository's actions in the command palette (Ctrl+K) */
export function useRepoCommands({ api, panels: p, sync, undoLast, branch, structure }: Deps) {
  const { repo, data, run, reload } = api;
  const head = data?.refs.head ?? "HEAD";
  const opKind = data?.state.kind;

  const commands: Command[] =
    !data || !repo
      ? []
      : [
          { id: "fetch", title: "Fetch", group: "Repositório", icon: RefreshCw, shortcut: ["Ctrl", "Shift", "F"], run: sync.fetch },
          { id: "pull", title: "Pull", group: "Repositório", icon: ArrowDownToLine, shortcut: ["Ctrl", "Shift", "L"], run: sync.pull },
          { id: "push", title: "Push", group: "Repositório", icon: ArrowUpFromLine, shortcut: ["Ctrl", "Shift", "P"], run: sync.push },
          { id: "reload", title: "Atualizar", group: "Repositório", icon: RefreshCw, keywords: "recarregar refresh", shortcut: ["F5"], run: reload },
          { id: "branch", title: "Nova branch...", group: "Repositório", icon: GitBranch, keywords: "criar", run: () => p.setBranchOpen(true) },
          { id: "stash", title: "Guardar alterações (stash)...", group: "Repositório", icon: Archive, run: () => p.setStashOpen(true) },
          { id: "worktree", title: "Nova worktree...", group: "Repositório", icon: FolderTree, keywords: "pasta paralela branch", run: () => p.setWorktreeOpen(true) },
          { id: "lfs", title: "Git LFS...", group: "Repositório", icon: Boxes, keywords: "arquivos grandes track", run: () => p.setLfsOpen(true) },
          ...(data.submodules.length
            ? [{ id: "submodules", title: "Atualizar submódulos", group: "Repositório", icon: Boxes, run: () => structure.updateSubmodules() }]
            : []),
          { id: "undo", title: "Desfazer última ação do git", group: "Repositório", icon: Undo2, keywords: "undo voltar", shortcut: ["Ctrl", "Z"], run: undoLast },
          { id: "time-machine", title: "Máquina do tempo (reflog)", group: "Repositório", icon: HistoryIcon, keywords: "reflog recuperar perdido", run: () => p.setTimeMachine(true) },
          { id: "browse", title: "Navegar pelos arquivos", group: "Repositório", icon: FolderTree, keywords: "blame árvore pasta conteúdo", run: () => p.setBrowser({ rev: "HEAD" }) },
          { id: "search", title: "Buscar commits", group: "Repositório", icon: Search, keywords: "procurar histórico", run: () => document.getElementById("history-search")?.focus() },
          { id: "editor", title: "Abrir no editor", group: "Repositório", icon: Code2, keywords: "vscode code", run: () => openInEditor(repo.path, "") },
          { id: "terminal-panel", title: "Terminal integrado", group: "Repositório", icon: SquareTerminal, keywords: "console shell powershell", shortcut: ["Ctrl", "`"], run: p.toggleTerminal },
          { id: "terminal", title: "Abrir terminal externo", group: "Repositório", icon: SquareTerminal, keywords: "windows terminal janela", run: () => git.openTerminal(repo.path).catch((e) => toast.error(String(e))) },
          { id: "tab-details", title: "Mostrar detalhes do commit", group: "Painel", icon: FileText, run: () => p.setTab("details") },
          { id: "tab-changes", title: "Mostrar alterações (commit)", group: "Painel", icon: GitCommitHorizontal, keywords: "stage preparar", run: () => p.setTab("changes") },
          { id: "tab-prs", title: "Mostrar pull requests", group: "Painel", icon: GitPullRequest, keywords: "pr github", run: () => p.setTab("prs") },
          ...(opKind
            ? [
                { id: "op-continue", title: "Continuar operação em andamento", group: "Repositório", icon: Play, run: () => run(opKind, (r) => git.operation(r, "continue")) },
                { id: "op-abort", title: "Abortar operação em andamento", group: "Repositório", icon: X, run: () => run(opKind, (r) => git.operation(r, "abort")) },
              ]
            : []),
          ...data.refs.branches
            .filter((b) => b !== head)
            .flatMap((b) => [
              { id: `co:${b}`, title: `Checkout ${b}`, group: "Branches", icon: LogIn, keywords: "trocar mudar", run: () => branch.checkout(b, false) },
              { id: `merge:${b}`, title: `Mesclar ${b} em ${head}`, group: "Branches", icon: GitMerge, keywords: "merge", run: () => branch.merge(b) },
            ]),
          ...data.refs.remotes.map((b) => ({
            id: `co-remote:${b}`,
            title: `Checkout ${b}`,
            group: "Branches remotas",
            icon: Cloud,
            run: () => branch.checkout(b, true),
          })),
        ];
  useCommands("repo", commands);
}
