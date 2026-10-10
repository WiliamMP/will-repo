import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Cloud,
  FolderTree,
  GitPullRequestArrow,
  CirclePlus,
  History as HistoryIcon,
  Undo2,
  Code2,
  FileText,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  LogIn,
  Search,
  SquareTerminal,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Check,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { BranchDialog } from "@/components/BranchDialog";
import { CommitDetails, StashDetails } from "@/components/CommitDetails";
import { FileBrowser, type BrowserTarget } from "@/components/FileBrowser";
import { TimeMachine } from "@/components/TimeMachine";
import { History, type CommitActions } from "@/components/History";
import { PullRequests } from "@/components/PullRequests";
import { Sidebar, type BranchActions } from "@/components/Sidebar";
import { StashDialog } from "@/components/StashDialog";
import { TagDialog } from "@/components/TagDialog";
import { WorkingTree } from "@/components/WorkingTree";
import { useRepo, type RepoApi } from "@/hooks/use-repo";
import { useSettings } from "@/hooks/use-settings";
import { useCommands, type Command } from "@/lib/commands";
import { splashDone, splashStep } from "@/lib/splash";
import { git, openInEditor, type Commit, type OpAction } from "@/lib/git";

const confirm = (message: string, title: string, okLabel: string) =>
  ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancelar" });

// Everything for one open repository. Each tab mounts its own RepoView.
export function RepoView({ path }: { path: string }) {
  const api = useRepo(path);
  const { repo, data, busy, error, run, reload, loadMore, focus, setFocus } = api;
  const [selected, setSelected] = useState<Commit | null>(null);
  const [stashName, setStashName] = useState<string | null>(null);
  const [tab, setTab] = useState("details");
  const [tagTarget, setTagTarget] = useState<Commit | null>(null);
  const [github, setGithub] = useState<string | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);
  const [browser, setBrowser] = useState<BrowserTarget | null>(null);
  const [timeMachine, setTimeMachine] = useState(false);
  // drag and drop of a branch onto another: the menu shows where it was dropped
  const [dropMenu, setDropMenu] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
  const [defaultBase, setDefaultBase] = useState("main");
  const { branchTemplates } = useSettings();
  useEffect(() => {
    git.defaultBranch(path).then(setDefaultBase, () => {});
  }, [path]);
  // last branch deleted in the app: deleting doesn't move HEAD, so the reflog can't undo it
  const deleted = useRef<{ name: string; hash: string; at: number } | null>(null);
  useEffect(() => {
    git.githubUrl(path).then(setGithub, () => setGithub(null));
  }, [path]);

  // Startup: this tab is what the user sees first, so the splash waits for its data
  useEffect(() => splashStep(`Abrindo ${path.split(/[\\/]/).pop()}`, 0.6), [path]);
  useEffect(() => {
    if (data || error) splashDone();
  }, [data, error]);

  const commits = data?.commits ?? [];
  // Default selection: newest commit. After a reload, refresh the object by hash.
  const commit = commits.find((c) => c.hash === selected?.hash) ?? selected ?? commits.find((c) => !c.stash) ?? null;
  const changes = data ? data.status.staged.length + data.status.unstaged.length + data.status.conflicted.length : 0;
  const stash = data?.stashes.find((s) => s.name === stashName);
  const head = data?.refs.head ?? "HEAD";

  // Something new in progress (merge/rebase with conflicts): jump to the changes tab
  const stateKind = data?.state.kind;
  useEffect(() => {
    if (stateKind) setTab("changes");
  }, [stateKind]);

  const fetch = () => run("fetch", (p) => git.fetch(p, false), "Fetch concluído");
  const pull = () => run("pull", git.pull, "Pull concluído");
  const push = () => run("push", git.push, "Push concluído");

  const { autoFetchMinutes } = useSettings();
  // Background fetch every few minutes (only the open tab is mounted, so only it fetches).
  // The interval callback reads `latest` because its closure would keep old state.
  const latest = useRef({ busy, behind: 0 });
  latest.current = { busy, behind: data?.tracking.behind ?? 0 };
  useEffect(() => {
    if (!autoFetchMinutes) return; // turned off in the settings
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

  // Ctrl+Z: undo the last git action (a deleted branch, or the last move of HEAD in the reflog)
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

  // Keyboard shortcuts (like TActionList shortcuts in Delphi)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "F5") {
        e.preventDefault();
        reload();
      } else if (e.ctrlKey && !e.shiftKey && k === "z" && !typing && !busy) {
        // inside a text box Ctrl+Z keeps undoing text
        e.preventDefault();
        undoLast();
      } else if (e.ctrlKey && e.shiftKey && !busy) {
        const action = { f: fetch, l: pull, p: push }[k];
        if (action) {
          e.preventDefault();
          action();
        }
      }
    };
    // Files may change outside the app (editor, terminal): refresh when the window gets focus
    const onFocus = () => reload();
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", onFocus);
    };
  });

  const branchActions: BranchActions = {
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
      const remember = (hash: string) => (deleted.current = { name, hash, at: Date.now() / 1000 });
      try {
        remember(await git.deleteBranch(path, name, false));
        toast.success(`Branch ${name} excluída`, { action: { label: "Desfazer", onClick: () => undoLast() } });
      } catch (e) {
        // -d refuses unmerged branches: offer force delete
        const force = await confirm(
          `${name} tem commits que não estão em nenhuma outra branch. Excluir mesmo assim? Esses commits podem ser perdidos.\n\n${e}`,
          "Branch não mesclada",
          "Excluir à força",
        );
        if (!force) return;
        await run("branch", async (p) => remember(await git.deleteBranch(p, name, true)), `Branch ${name} excluída (Ctrl+Z desfaz)`);
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
    drop: (source, target, x, y) => setDropMenu({ source, target, x, y }),
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

  // Conflicts leave the operation in progress: the banner and the changes tab take over
  const commitActions: CommitActions = {
    cherryPick: (c) => run("cherry-pick", (p) => git.pick(p, c.hash, false), `${c.hash.slice(0, 7)} aplicado em ${head}`),
    revert: (c) => run("revert", (p) => git.pick(p, c.hash, true), `${c.hash.slice(0, 7)} revertido`),
    tag: setTagTarget,
    browse: (c) => setBrowser({ rev: c.hash }),
  };

  /** From blame/file history: show that commit in the main history */
  const selectCommit = (hash: string) => {
    const c = commits.find((x) => x.hash === hash);
    if (!c) return toast.info("Esse commit está fora do histórico carregado. Use \"Carregar mais\" ou a busca.");
    setBrowser(null);
    setSelected(c);
    setStashName(null);
    setTab("details");
  };

  const stashAction = async (action: "apply" | "pop" | "drop") => {
    if (!stash) return;
    if (action === "drop" && !(await confirm(`Excluir ${stash.name}? Isso não pode ser desfeito.`, "Excluir stash", "Excluir")))
      return;
    const done = { apply: "Stash aplicado", pop: "Stash aplicado e removido", drop: "Stash excluído" }[action];
    if (await run("stash", (p) => git.stashAction(p, stash.name, action), done)) {
      if (action !== "apply") setStashName(null);
      if (action !== "drop") setTab("changes");
    }
  };

  // Commands of this repository for the palette (Ctrl+K)
  const opKind = data?.state.kind;
  const repoCommands: Command[] = !data
    ? []
    : [
        { id: "fetch", title: "Fetch", group: "Repositório", icon: RefreshCw, shortcut: ["Ctrl", "Shift", "F"], run: fetch },
        { id: "pull", title: "Pull", group: "Repositório", icon: ArrowDownToLine, shortcut: ["Ctrl", "Shift", "L"], run: pull },
        { id: "push", title: "Push", group: "Repositório", icon: ArrowUpFromLine, shortcut: ["Ctrl", "Shift", "P"], run: push },
        { id: "reload", title: "Atualizar", group: "Repositório", icon: RefreshCw, keywords: "recarregar refresh", shortcut: ["F5"], run: reload },
        { id: "branch", title: "Nova branch...", group: "Repositório", icon: GitBranch, keywords: "criar", run: () => setBranchOpen(true) },
        { id: "stash", title: "Guardar alterações (stash)...", group: "Repositório", icon: Archive, run: () => setStashOpen(true) },
        { id: "undo", title: "Desfazer última ação do git", group: "Repositório", icon: Undo2, keywords: "undo voltar", shortcut: ["Ctrl", "Z"], run: undoLast },
        { id: "time-machine", title: "Máquina do tempo (reflog)", group: "Repositório", icon: HistoryIcon, keywords: "reflog recuperar perdido", run: () => setTimeMachine(true) },
        { id: "browse", title: "Navegar pelos arquivos", group: "Repositório", icon: FolderTree, keywords: "blame árvore pasta conteúdo", run: () => setBrowser({ rev: "HEAD" }) },
        { id: "search", title: "Buscar commits", group: "Repositório", icon: Search, keywords: "procurar histórico", run: () => document.getElementById("history-search")?.focus() },
        { id: "editor", title: "Abrir no editor", group: "Repositório", icon: Code2, keywords: "vscode code", run: () => openInEditor(repo!.path, "") },
        { id: "terminal", title: "Abrir terminal aqui", group: "Repositório", icon: SquareTerminal, run: () => git.openTerminal(repo!.path).catch((e) => toast.error(String(e))) },
        { id: "tab-details", title: "Mostrar detalhes do commit", group: "Painel", icon: FileText, run: () => setTab("details") },
        { id: "tab-changes", title: "Mostrar alterações (commit)", group: "Painel", icon: GitCommitHorizontal, keywords: "stage preparar", run: () => setTab("changes") },
        { id: "tab-prs", title: "Mostrar pull requests", group: "Painel", icon: GitPullRequest, keywords: "pr github", run: () => setTab("prs") },
        ...(opKind
          ? [
              { id: "op-continue", title: "Continuar operação em andamento", group: "Repositório", icon: Play, run: () => run(opKind, (p) => git.operation(p, "continue")) },
              { id: "op-abort", title: "Abortar operação em andamento", group: "Repositório", icon: X, run: () => run(opKind, (p) => git.operation(p, "abort")) },
            ]
          : []),
        ...data.refs.branches
          .filter((b) => b !== head)
          .flatMap((b) => [
            { id: `co:${b}`, title: `Checkout ${b}`, group: "Branches", icon: LogIn, keywords: "trocar mudar", run: () => branchActions.checkout(b, false) },
            { id: `merge:${b}`, title: `Mesclar ${b} em ${head}`, group: "Branches", icon: GitMerge, keywords: "merge", run: () => branchActions.merge(b) },
          ]),
        ...data.refs.remotes.map((b) => ({
          id: `co-remote:${b}`,
          title: `Checkout ${b}`,
          group: "Branches remotas",
          icon: Cloud,
          run: () => branchActions.checkout(b, true),
        })),
      ];
  useCommands("repo", repoCommands);

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
          <ToolbarButton icon={RefreshCw} label="Fetch" keys={["Ctrl", "Shift", "F"]} onClick={fetch} busy={busy} id="fetch" />
          <ToolbarButton icon={ArrowDownToLine} label="Pull" keys={["Ctrl", "Shift", "L"]} onClick={pull} busy={busy} id="pull" />
          <ToolbarButton icon={ArrowUpFromLine} label="Push" keys={["Ctrl", "Shift", "P"]} onClick={push} busy={busy} id="push" />
          <StashDialog
            open={stashOpen}
            onOpenChange={setStashOpen}
            disabled={!!busy || changes === 0}
            onStash={(message, untracked) => run("stash", (p) => git.stashPush(p, message, untracked), "Alterações guardadas")}
          />
          <BranchDialog
            open={branchOpen}
            onOpenChange={setBranchOpen}
            disabled={!!busy}
            branches={data.refs.branches}
            defaultBase={defaultBase}
            onCreate={(name, checkout, from) => run("branch", (p) => git.createBranch(p, name, checkout, from), `Branch ${name} criada`)}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="Desfazer última ação do git (Ctrl+Z)" disabled={!!busy} onClick={undoLast}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="Máquina do tempo: tudo por onde o HEAD passou" onClick={() => setTimeMachine(true)}>
            <HistoryIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            title="Abrir a pasta no editor (Configurações > Integrações)"
            onClick={() => openInEditor(repo.path, "")}
          >
            <Code2 /> Editor
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            title="Abrir um terminal na pasta (Configurações > Integrações)"
            onClick={() => git.openTerminal(repo.path).catch((e) => toast.error(String(e)))}
          >
            <SquareTerminal /> Terminal
          </Button>
        </div>
      </header>

      {dropMenu && <DropMenu {...dropMenu} head={head} remotes={data.refs.remotes} run={run} onClose={() => setDropMenu(null)} />}
      <TimeMachine repo={repo.path} open={timeMachine} onOpenChange={setTimeMachine} run={run} onUndo={() => {
        setTimeMachine(false);
        undoLast();
      }} />
      <FileBrowser repo={repo.path} target={browser} onClose={() => setBrowser(null)} onSelectCommit={selectCommit} />

      <TagDialog
        commit={tagTarget}
        onClose={() => setTagTarget(null)}
        onCreate={(name, message) =>
          run("tag", (p) => git.createTag(p, name, tagTarget!.hash, message), `Tag ${name} criada`)
        }
      />

      <OperationBanner api={api} onShowConflicts={() => setTab("changes")} />

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="18" minSize={180}>
          <Sidebar
            refs={data.refs}
            stashes={data.stashes}
            selectedStash={stash?.name ?? null}
            onSelectStash={(name) => {
              setStashName(name);
              setTab("details");
            }}
            actions={branchActions}
            hidden={focus.hidden}
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
            actions={commitActions}
            focus={focus}
            onClearFocus={() => setFocus({ solo: null, hidden: [] })}
            onBranchDrop={(source, target, x, y) => setDropMenu({ source, target, x, y })}
            onSelect={(c) => {
              // a stash node in the graph opens the stash details, like the sidebar
              if (c.stash) setStashName(c.stash);
              else {
                setSelected(c);
                setStashName(null);
              }
              setTab("details");
            }}
          />
        </ResizablePanel>
        <ResizableHandle />

        <ResizablePanel defaultSize="32" minSize={340}>
          <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col gap-0 bg-card">
            <div className="border-b p-2">
              <TabsList>
                <TabsTrigger value="details">Detalhes</TabsTrigger>
                <TabsTrigger value="changes" className="gap-1.5">
                  Alterações
                  {changes > 0 && (
                    <Badge
                      variant={data.status.conflicted.length ? "destructive" : "default"}
                      className="h-4 min-w-4 px-1 text-[10px]"
                    >
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
                  onBrowse={(path) => setBrowser({ rev: commit.hash, path, tab: path ? "blame" : "content" })}
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
                onFileHistory={(path) => setBrowser({ rev: "HEAD", path, tab: "blame" })}
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

      <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-card px-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <GitBranch className="size-3.5" /> {data.refs.head ?? "HEAD destacado"}
        </span>
        {data.tracking.upstream ? (
          <>
            <span className="flex items-center gap-2" title={`Comparado com ${data.tracking.upstream}`}>
              <span className="flex items-center">
                <ArrowUp className="size-3.5" />
                {data.tracking.ahead}
              </span>
              <span className="flex items-center">
                <ArrowDown className="size-3.5" />
                {data.tracking.behind}
              </span>
            </span>
            {data.tracking.ahead === 0 && data.tracking.behind === 0 && (
              <AnimatedShinyText className="mx-0 flex items-center gap-1 text-xs">
                <Check className="size-3.5" /> Sincronizado com {data.tracking.upstream}
              </AnimatedShinyText>
            )}
          </>
        ) : (
          <span>Sem upstream</span>
        )}
        <span className="ml-auto">{commits.length} commits carregados</span>
        {busy && (
          <span className="flex items-center gap-1 text-primary">
            <Loader2 className="size-3.5 animate-spin" /> {busy}...
          </span>
        )}
      </footer>
    </>
  );
}

/** Shown while a merge/rebase/cherry-pick/revert is unfinished */
function OperationBanner({ api, onShowConflicts }: { api: RepoApi; onShowConflicts: () => void }) {
  const { data, busy, run } = api;
  if (!data?.state.kind) return null;
  const { kind, label, step } = data.state;
  const conflicts = data.status.conflicted.length;
  const name = { merge: "Merge", rebase: "Rebase", "cherry-pick": "Cherry-pick", revert: "Revert" }[kind];

  const act = async (action: OpAction) => {
    if (action === "abort") {
      const ok = await confirm(`Cancelar o ${name.toLowerCase()} e voltar ao estado anterior?`, `Abortar ${name}`, "Abortar");
      if (!ok) return;
    }
    const done = { continue: `${name} continuado`, abort: `${name} abortado`, skip: "Commit pulado" }[action];
    run(name.toLowerCase(), (p) => git.operation(p, action), done);
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">
          {name} em andamento{step && ` (${step})`}
        </span>
        <span className="ml-2 truncate text-muted-foreground">{label}</span>
        <span className="ml-2">
          {conflicts > 0 ? (
            <button className="text-destructive underline-offset-2 hover:underline" onClick={onShowConflicts}>
              {conflicts} arquivo(s) com conflito
            </button>
          ) : (
            <span className="text-success">Sem conflitos: pode continuar</span>
          )}
        </span>
      </div>
      <Button size="xs" disabled={!!busy || conflicts > 0} onClick={() => act("continue")}>
        <Play /> Continuar
      </Button>
      {kind === "rebase" && (
        <Button size="xs" variant="outline" disabled={!!busy} onClick={() => act("skip")}>
          <SkipForward /> Pular commit
        </Button>
      )}
      <Button size="xs" variant="destructive" disabled={!!busy} onClick={() => act("abort")}>
        <X /> Abortar
      </Button>
    </div>
  );
}

type ToolbarButtonProps = {
  icon: LucideIcon;
  label: string;
  keys: string[];
  onClick: () => void;
  busy?: string | null;
  id?: string;
};

export function ToolbarButton({ icon: Icon, label, keys, onClick, busy, id }: ToolbarButtonProps) {
  const spinning = !!id && busy === id;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!!busy} onClick={onClick}>
          {spinning ? <Loader2 className="animate-spin" /> : <Icon />} {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

type DropMenuProps = {
  source: string;
  target: string;
  x: number;
  y: number;
  head: string;
  /** remote branch names: checking one out creates a local branch */
  remotes: string[];
  run: RepoApi["run"];
  onClose: () => void;
};

/** What to do after dropping branch `source` onto branch `target` (like GitKraken) */
function DropMenu({ source, target, x, y, head, remotes, run, onClose }: DropMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sourceLocal = source.replace(/^[^/]+\//, ""); // origin/x -> x, only to check if it is HEAD
  const options: { icon: LucideIcon; label: string; action: (p: string) => Promise<unknown>; done: string }[] = [];
  if (target === head) {
    options.push(
      { icon: GitMerge, label: `Mesclar ${source} em ${target}`, action: (p) => git.merge(p, source), done: `${source} mesclada em ${target}` },
      { icon: GitPullRequestArrow, label: `Rebase de ${target} sobre ${source}`, action: (p) => git.rebase(p, source), done: `Rebase concluído` },
      { icon: CirclePlus, label: `Cherry-pick do último commit de ${source}`, action: (p) => git.pick(p, source, false), done: `Commit de ${source} aplicado` },
    );
  } else if (source === head || sourceLocal === head) {
    options.push(
      { icon: GitPullRequestArrow, label: `Rebase de ${source} sobre ${target}`, action: (p) => git.rebase(p, target), done: `Rebase concluído` },
      { icon: GitMerge, label: `Mesclar ${target} em ${source}`, action: (p) => git.merge(p, target), done: `${target} mesclada em ${source}` },
    );
  } else {
    // neither is the current branch: checkout first
    options.push(
      {
        icon: GitMerge,
        label: `Checkout ${target} e mesclar ${source}`,
        action: async (p) => {
          await git.checkout(p, target, false);
          await git.merge(p, source);
        },
        done: `${source} mesclada em ${target}`,
      },
      {
        icon: GitPullRequestArrow,
        label: `Checkout ${source} e rebase sobre ${target}`,
        action: async (p) => {
          await git.checkout(p, source, remotes.includes(source));
          await git.rebase(p, target);
        },
        done: `Rebase de ${source} sobre ${target} concluído`,
      },
    );
  }

  return (
    <>
      {/* invisible layer: a click anywhere else closes the menu */}
      <div className="fixed inset-0 z-50" onMouseDown={onClose} />
      <div
        className="fixed z-50 min-w-64 overflow-hidden rounded-lg border bg-popover p-1 shadow-[0_0_40px_-10px_var(--glow)]"
        style={{ left: Math.min(x, window.innerWidth - 300), top: Math.min(y, window.innerHeight - 160) }}
      >
        <p className="px-2 py-1.5 text-[11px] tracking-wider text-muted-foreground uppercase">
          {source} → {target}
        </p>
        {options.map((o) => (
          <button
            key={o.label}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onClose();
              run("arrastar", o.action, o.done);
            }}
          >
            <o.icon className="size-4 text-primary" /> {o.label}
          </button>
        ))}
      </div>
    </>
  );
}
