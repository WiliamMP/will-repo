import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Code2,
  GitBranch,
  History as HistoryIcon,
  Loader2,
  RefreshCw,
  SquareTerminal,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BranchDialog } from "@/components/BranchDialog";
import { CommitDetails, StashDetails } from "@/components/CommitDetails";
import { FileBrowser } from "@/components/FileBrowser";
import { History } from "@/components/History";
import { PullRequests } from "@/components/PullRequests";
import { LfsDialog, StructureSections, WorktreeDialog } from "@/components/RepoStructure";
import { Sidebar } from "@/components/Sidebar";
import { StashDialog } from "@/components/StashDialog";
import { TagDialog } from "@/components/TagDialog";
import { TerminalPanel } from "@/components/TerminalPanel";
import { TimeMachine } from "@/components/TimeMachine";
import { WorkingTree } from "@/components/WorkingTree";
import { DropMenu } from "@/components/repo/DropMenu";
import { OperationBanner } from "@/components/repo/OperationBanner";
import { RepoFooter } from "@/components/repo/RepoFooter";
import { ToolbarButton } from "@/components/repo/ToolbarButton";
import { useAutoFetch } from "@/hooks/repo/use-auto-fetch";
import { useBranchActions } from "@/hooks/repo/use-branch-actions";
import { usePanels, type RightTab } from "@/hooks/repo/use-panels";
import { useRepoCommands } from "@/hooks/repo/use-repo-commands";
import { useRepoShortcuts } from "@/hooks/repo/use-repo-shortcuts";
import { useUndo } from "@/hooks/repo/use-undo";
import { useRepo } from "@/hooks/use-repo";
import { confirm } from "@/lib/confirm";
import { git, openInEditor } from "@/lib/git";
import { splashDone, splashStep } from "@/lib/splash";

type RepoViewProps = {
  path: string;
  /** opens another repository (submodule, worktree) in a new tab */
  onOpenRepo: (path: string) => void;
};

// Everything for one open repository; each tab mounts its own RepoView.
// The logic lives in hooks (src/hooks/repo), like a form whose events delegate to
// separate units; this file only lays the parts out.
export function RepoView({ path, onOpenRepo }: RepoViewProps) {
  const api = useRepo(path);
  const { repo, data, busy, error, run, reload, loadMore, focus, setFocus } = api;
  const panels = usePanels();
  const undo = useUndo(path, run);
  const actions = useBranchActions({ api, panels, undo, onOpenRepo });

  const sync = {
    fetch: () => run("fetch", (p) => git.fetch(p, false), "Fetch concluído"),
    pull: () => run("pull", git.pull, "Pull concluído"),
    push: () => run("push", git.push, "Push concluído"),
  };
  useAutoFetch(api);
  useRepoShortcuts({ busy, reload, undo: undo.undoLast, toggleTerminal: panels.toggleTerminal, ...sync });
  useRepoCommands({ api, panels, sync, undoLast: undo.undoLast, branch: actions.branch, structure: actions.structure });

  const [github, setGithub] = useState<string | null>(null);
  useEffect(() => {
    git.githubUrl(path).then(setGithub, () => setGithub(null));
  }, [path]);

  // Startup: this tab is what the user sees first, so the splash waits for its data
  useEffect(() => splashStep(`Abrindo ${path.split(/[\\/]/).pop()}`, 0.6), [path]);
  useEffect(() => {
    if (data || error) splashDone();
  }, [data, error]);

  // Something new in progress (merge/rebase with conflicts): jump to the changes tab
  const stateKind = data?.state.kind;
  useEffect(() => {
    if (stateKind) panels.setTab("changes");
  }, [stateKind]);

  const commits = data?.commits ?? [];
  // Default selection: newest commit. After a reload, refresh the object by hash.
  const commit = commits.find((c) => c.hash === panels.selected?.hash) ?? panels.selected ?? commits.find((c) => !c.stash) ?? null;
  const changes = data ? data.status.staged.length + data.status.unstaged.length + data.status.conflicted.length : 0;
  const stash = data?.stashes.find((s) => s.name === panels.stashName);
  const head = data?.refs.head ?? "HEAD";

  /** From blame/file history: show that commit in the main history */
  const selectCommit = (hash: string) => {
    const c = commits.find((x) => x.hash === hash);
    if (!c) return toast.info('Esse commit está fora do histórico carregado. Use "Carregar mais" ou a busca.');
    panels.setBrowser(null);
    panels.showCommit(c);
  };

  const stashAction = async (action: "apply" | "pop" | "drop") => {
    if (!stash) return;
    if (action === "drop" && !(await confirm(`Excluir ${stash.name}? Isso não pode ser desfeito.`, "Excluir stash", "Excluir")))
      return;
    const done = { apply: "Stash aplicado", pop: "Stash aplicado e removido", drop: "Stash excluído" }[action];
    if (await run("stash", (p) => git.stashAction(p, stash.name, action), done)) {
      if (action !== "apply") panels.setStashName(null);
      if (action !== "drop") panels.setTab("changes");
    }
  };

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertTriangle className="size-6 text-destructive" />
        <p>{error}</p>
        <code className="text-xs">{path}</code>
      </div>
    );
  }
  if (!repo || !data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-4 border-b bg-card px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold" title={repo.path}>
            {repo.name}
          </span>
          <Badge className="gap-1 font-mono">
            <GitBranch /> {data.refs.head ?? "HEAD destacado"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton icon={RefreshCw} label="Fetch" keys={["Ctrl", "Shift", "F"]} onClick={sync.fetch} busy={busy} id="fetch" />
          <ToolbarButton icon={ArrowDownToLine} label="Pull" keys={["Ctrl", "Shift", "L"]} onClick={sync.pull} busy={busy} id="pull" />
          <ToolbarButton icon={ArrowUpFromLine} label="Push" keys={["Ctrl", "Shift", "P"]} onClick={sync.push} busy={busy} id="push" />
          <StashDialog
            open={panels.stashOpen}
            onOpenChange={panels.setStashOpen}
            disabled={!!busy || changes === 0}
            onStash={(message, untracked) => run("stash", (p) => git.stashPush(p, message, untracked), "Alterações guardadas")}
          />
          <BranchDialog
            open={panels.branchOpen}
            onOpenChange={panels.setBranchOpen}
            disabled={!!busy}
            branches={data.refs.branches}
            defaultBase={actions.defaultBase}
            onCreate={(name, checkout, from) => run("branch", (p) => git.createBranch(p, name, checkout, from), `Branch ${name} criada`)}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="Desfazer última ação do git (Ctrl+Z)" disabled={!!busy} onClick={undo.undoLast}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="Máquina do tempo: tudo por onde o HEAD passou" onClick={() => panels.setTimeMachine(true)}>
            <HistoryIcon />
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" title="Abrir a pasta no editor (Configurações > Integrações)" onClick={() => openInEditor(repo.path, "")}>
            <Code2 /> Editor
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            title="Terminal integrado (Ctrl+`). O terminal externo fica na paleta (Ctrl+K)."
            onClick={panels.toggleTerminal}
          >
            <SquareTerminal /> Terminal
          </Button>
        </div>
      </header>

      <WorktreeDialog
        open={panels.worktreeOpen}
        onOpenChange={panels.setWorktreeOpen}
        repo={repo.path}
        branches={data.refs.branches}
        busy={data.worktrees.flatMap((w) => (w.branch ? [w.branch] : []))}
        onCreate={async (dir, branch, isNew) => {
          const ok = await run("worktree", (p) => git.worktreeAdd(p, dir, branch, isNew), `Worktree de ${branch} criada`);
          if (ok) onOpenRepo(dir);
          return ok;
        }}
      />
      <LfsDialog open={panels.lfsOpen} onOpenChange={panels.setLfsOpen} repo={repo.path} />
      {panels.dropMenu && <DropMenu {...panels.dropMenu} head={head} remotes={data.refs.remotes} run={run} onClose={() => panels.setDropMenu(null)} />}
      <TimeMachine
        repo={repo.path}
        open={panels.timeMachine}
        onOpenChange={panels.setTimeMachine}
        run={run}
        onUndo={() => {
          panels.setTimeMachine(false);
          undo.undoLast();
        }}
      />
      <FileBrowser repo={repo.path} target={panels.browser} onClose={() => panels.setBrowser(null)} onSelectCommit={selectCommit} />
      <TagDialog
        commit={panels.tagTarget}
        onClose={() => panels.setTagTarget(null)}
        onCreate={(name, message) => run("tag", (p) => git.createTag(p, name, panels.tagTarget!.hash, message), `Tag ${name} criada`)}
      />

      <OperationBanner api={api} onShowConflicts={() => panels.setTab("changes")} />

      {/* main area on top, integrated terminal below (Ctrl+`) */}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="main" minSize={200}>
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel defaultSize="18" minSize={180}>
              <Sidebar
                refs={data.refs}
                stashes={data.stashes}
                selectedStash={stash?.name ?? null}
                onSelectStash={panels.showStash}
                actions={actions.branch}
                hidden={focus.hidden}
                extra={<StructureSections submodules={data.submodules} worktrees={data.worktrees} actions={actions.structure} />}
              />
            </ResizablePanel>
            <ResizableHandle />

            <ResizablePanel defaultSize="50" minSize={360}>
              <History
                repo={repo.path}
                commits={commits}
                selected={stash ? null : (commit?.hash ?? null)}
                hasMore={data.hasMore}
                onLoadMore={loadMore}
                actions={actions.commit}
                focus={focus}
                onClearFocus={() => setFocus({ solo: null, hidden: [] })}
                onBranchDrop={actions.branch.drop}
                // a stash node in the graph opens the stash details, like the sidebar
                onSelect={(c) => (c.stash ? panels.showStash(c.stash) : panels.showCommit(c))}
              />
            </ResizablePanel>
            <ResizableHandle />

            <ResizablePanel defaultSize="32" minSize={340}>
              <Tabs value={panels.tab} onValueChange={(t) => panels.setTab(t as RightTab)} className="flex h-full flex-col gap-0 bg-card">
                <div className="border-b p-2">
                  <TabsList>
                    <TabsTrigger value="details">Detalhes</TabsTrigger>
                    <TabsTrigger value="changes" className="gap-1.5">
                      Alterações
                      {changes > 0 && (
                        <Badge variant={data.status.conflicted.length ? "destructive" : "default"} className="h-4 min-w-4 px-1 text-[10px]">
                          {changes}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="prs">Pull Requests</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="details" className="flex min-h-0 flex-col">
                  {stash ? (
                    <StashDetails
                      repo={repo.path}
                      stash={stash}
                      actions={
                        <>
                          <Button size="xs" disabled={!!busy} onClick={() => stashAction("pop")}>
                            <ArchiveRestore /> Aplicar e remover
                          </Button>
                          <Button size="xs" variant="outline" disabled={!!busy} onClick={() => stashAction("apply")}>
                            <Archive /> Aplicar
                          </Button>
                          <Button size="xs" variant="destructive" disabled={!!busy} onClick={() => stashAction("drop")}>
                            <Trash2 /> Excluir
                          </Button>
                        </>
                      }
                    />
                  ) : commit ? (
                    <CommitDetails
                      repo={repo.path}
                      commit={commit}
                      github={github}
                      onBrowse={(file) => panels.setBrowser({ rev: commit.hash, path: file, tab: file ? "blame" : "content" })}
                    />
                  ) : (
                    <p className="p-4 text-muted-foreground">Nenhum commit ainda.</p>
                  )}
                </TabsContent>
                <TabsContent value="changes" className="flex min-h-0 flex-col">
                  <WorkingTree
                    repo={repo.path}
                    status={data.status}
                    state={data.state}
                    headPushed={!!data.tracking.upstream && data.tracking.ahead === 0}
                    onFileHistory={(file) => panels.setBrowser({ rev: "HEAD", path: file, tab: "blame" })}
                    recent={[...new Set(commits.slice(0, 30).map((c) => c.subject))].slice(0, 8)}
                    run={run}
                  />
                </TabsContent>
                <TabsContent value="prs" className="flex min-h-0 flex-col">
                  <PullRequests repo={repo.path} head={data.refs.head} tracking={data.tracking} run={run} />
                </TabsContent>
              </Tabs>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        {panels.terminalOpen && (
          <>
            <ResizableHandle />
            <ResizablePanel id="terminal" defaultSize="35" minSize={120}>
              <TerminalPanel cwd={repo.path} onClose={() => panels.setTerminalOpen(false)} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <RepoFooter head={data.refs.head} tracking={data.tracking} loaded={commits.length} busy={busy} />
    </>
  );
}
