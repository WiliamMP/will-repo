import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Code2,
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
import { History, type CommitActions } from "@/components/History";
import { PullRequests } from "@/components/PullRequests";
import { Sidebar, type BranchActions } from "@/components/Sidebar";
import { StashDialog } from "@/components/StashDialog";
import { TagDialog } from "@/components/TagDialog";
import { WorkingTree } from "@/components/WorkingTree";
import { useRepo, type RepoApi } from "@/hooks/use-repo";
import { useSettings } from "@/hooks/use-settings";
import { git, openInEditor, type Commit, type OpAction } from "@/lib/git";

const confirm = (message: string, title: string, okLabel: string) =>
  ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancelar" });

// Everything for one open repository. Each tab mounts its own RepoView.
export function RepoView({ path }: { path: string }) {
  const api = useRepo(path);
  const { repo, data, busy, error, run, reload, loadMore } = api;
  const [selected, setSelected] = useState<Commit | null>(null);
  const [stashName, setStashName] = useState<string | null>(null);
  const [tab, setTab] = useState("details");
  const [tagTarget, setTagTarget] = useState<Commit | null>(null);
  const [github, setGithub] = useState<string | null>(null);
  useEffect(() => {
    git.githubUrl(path).then(setGithub, () => setGithub(null));
  }, [path]);

  const commits = data?.commits ?? [];
  // Default selection: newest commit. After a reload, refresh the object by hash.
  const commit = commits.find((c) => c.hash === selected?.hash) ?? selected ?? commits[0] ?? null;
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

  // Keyboard shortcuts (like TActionList shortcuts in Delphi)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === "F5") {
        e.preventDefault();
        reload();
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
      if (!(await confirm(`Excluir a branch ${name}?`, "Excluir branch", "Excluir"))) return;
      try {
        await git.deleteBranch(path, name, false);
      } catch (e) {
        // -d refuses unmerged branches: offer force delete
        const force = await confirm(
          `${name} tem commits que não estão em nenhuma outra branch. Excluir mesmo assim? Esses commits podem ser perdidos.\n\n${e}`,
          "Branch não mesclada",
          "Excluir à força",
        );
        if (!force) return;
        await run("branch", (p) => git.deleteBranch(p, name, true));
      }
      reload();
    },
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
            disabled={!!busy || changes === 0}
            onStash={(message, untracked) => run("stash", (p) => git.stashPush(p, message, untracked), "Alterações guardadas")}
          />
          <BranchDialog
            disabled={!!busy}
            onCreate={(name, checkout) => run("branch", (p) => git.createBranch(p, name, checkout), `Branch ${name} criada`)}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
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
            onSelect={(c) => {
              setSelected(c);
              setStashName(null);
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
                <CommitDetails repo={repo.path} commit={commit} github={github} />
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
