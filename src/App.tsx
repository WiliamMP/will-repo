import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Check,
  FolderOpen,
  GitBranch,
  GitFork,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { DotPattern } from "@/components/ui/dot-pattern";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BranchDialog } from "@/components/BranchDialog";
import { CommitDetails } from "@/components/CommitDetails";
import { History } from "@/components/History";
import { Sidebar } from "@/components/Sidebar";
import { WorkingTree } from "@/components/WorkingTree";
import { useRepo } from "@/hooks/use-repo";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { git } from "@/lib/git";

export default function App() {
  const [theme, setTheme] = useTheme();
  const { repo, data, busy, open, run, reload } = useRepo();
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [tab, setTab] = useState("details");

  const commits = data?.commits ?? [];
  // Keep the selection by hash so a reload doesn't jump to another commit
  const selected = Math.max(0, commits.findIndex((c) => c.hash === selectedHash));
  const changes = data ? data.status.staged.length + data.status.unstaged.length : 0;

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: "Abrir repositório git" });
    if (typeof dir === "string") open(dir);
  };

  const fetch = () => run("fetch", git.fetch, "Fetch concluído");
  const pull = () => run("pull", git.pull, "Pull concluído");
  const push = () => run("push", git.push, "Push concluído");

  // Keyboard shortcuts (like TActionList shortcuts in Delphi)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && k === "o") {
        e.preventDefault();
        pickFolder();
      } else if (e.key === "F5") {
        e.preventDefault();
        reload();
      } else if (e.ctrlKey && e.shiftKey && repo && !busy) {
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

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster theme={theme} position="bottom-right" richColors />
      <div className="flex h-full flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary shadow-[0_0_14px_var(--glow)]">
              <GitFork className="size-4" />
            </div>
            <span className="truncate font-semibold" title={repo?.path}>
              {repo?.name ?? "will-repo"}
            </span>
            {data?.refs.head && (
              <Badge className="gap-1 font-mono">
                <GitBranch /> {data.refs.head}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            <ToolbarButton icon={FolderOpen} label="Abrir" keys={["Ctrl", "O"]} onClick={pickFolder} />
            {repo && (
              <>
                <ToolbarButton icon={RefreshCw} label="Fetch" keys={["Ctrl", "Shift", "F"]} onClick={fetch} busy={busy} id="fetch" />
                <ToolbarButton icon={ArrowDownToLine} label="Pull" keys={["Ctrl", "Shift", "L"]} onClick={pull} busy={busy} id="pull" />
                <ToolbarButton icon={ArrowUpFromLine} label="Push" keys={["Ctrl", "Shift", "P"]} onClick={push} busy={busy} id="push" />
                <BranchDialog
                  disabled={!!busy}
                  onCreate={(name, checkout) =>
                    run("branch", (p) => git.createBranch(p, name, checkout), `Branch ${name} criada`)
                  }
                />
              </>
            )}
          </div>

          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            className="ml-auto"
            value={theme}
            onValueChange={(v) => v && setTheme(v as ThemeMode)}
          >
            {(
              [
                ["system", Monitor, "Tema do sistema"],
                ["dark", Moon, "Tema escuro"],
                ["light", Sun, "Tema claro"],
              ] as const
            ).map(([value, Icon, label]) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={label}
                title={label}
                className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
              >
                <Icon />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </header>

        {!repo || !data ? (
          <EmptyState loading={!!repo} onOpen={pickFolder} />
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize="18" minSize={180}>
              <Sidebar
                refs={data.refs}
                onCheckout={(name, remote) => run("checkout", (p) => git.checkout(p, name, remote), `Checkout em ${name}`)}
              />
            </ResizablePanel>
            <ResizableHandle />

            <ResizablePanel defaultSize="50" minSize={360}>
              <History
                commits={commits}
                selected={selected}
                onSelect={(i) => {
                  setSelectedHash(commits[i].hash);
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
                      {changes > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{changes}</Badge>}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="details" className="flex min-h-0 flex-col">
                  {commits[selected] ? (
                    <CommitDetails repo={repo.path} commit={commits[selected]} />
                  ) : (
                    <p className="p-4 text-muted-foreground">Nenhum commit ainda.</p>
                  )}
                </TabsContent>
                <TabsContent value="changes" className="flex min-h-0 flex-col">
                  <WorkingTree repo={repo.path} status={data.status} run={run} />
                </TabsContent>
              </Tabs>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-card px-3 text-xs text-muted-foreground">
          {data && (
            <>
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
            </>
          )}
          {busy && (
            <span className="ml-auto flex items-center gap-1 text-primary">
              <Loader2 className="size-3.5 animate-spin" /> {busy}...
            </span>
          )}
        </footer>
      </div>
    </TooltipProvider>
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

function ToolbarButton({ icon: Icon, label, keys, onClick, busy, id }: ToolbarButtonProps) {
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

function EmptyState({ loading, onOpen }: { loading: boolean; onOpen: () => void }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden">
      <DotPattern className="text-primary/25 [mask-image:radial-gradient(360px_circle_at_center,white,transparent)]" />
      {loading ? (
        <Loader2 className="relative size-6 animate-spin text-primary" />
      ) : (
        <>
          <div className="relative grid size-14 place-items-center rounded-xl bg-primary/15 text-primary shadow-[0_0_24px_var(--glow)]">
            <GitFork className="size-7" />
          </div>
          <div className="relative text-center">
            <h1 className="text-lg font-semibold">Nenhum repositório aberto</h1>
            <p className="text-muted-foreground">Escolha uma pasta com um repositório git.</p>
          </div>
          <ShimmerButton
            background="var(--primary)"
            borderRadius="8px"
            shimmerColor="#c4b5ff"
            className="h-9 gap-2 px-4 text-sm font-medium"
            onClick={onOpen}
          >
            <FolderOpen className="size-4" /> Abrir repositório
          </ShimmerButton>
        </>
      )}
    </div>
  );
}
