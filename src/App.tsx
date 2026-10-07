import { useEffect, useState } from "react";
import { FolderGit2, FolderOpen, GitFork, Monitor, Moon, Plus, Sun, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DotPattern } from "@/components/ui/dot-pattern";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { RepoView } from "@/components/RepoView";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { git } from "@/lib/git";
import { cn } from "@/lib/utils";

type Tabs = { paths: string[]; active: string | null };

const TABS_KEY = "will-repo.tabs";
const RECENT_KEY = "will-repo.recent";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
    // older versions stored only the last repo
    const last = key === TABS_KEY && localStorage.getItem("will-repo.lastRepo");
    if (last) return { paths: [last], active: last } as T;
  } catch {}
  return fallback;
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

// Shell: tab bar + one RepoView per tab (like a TPageControl with a frame per page)
export default function App() {
  const [theme, setTheme] = useTheme();
  const [tabs, setTabs] = useState<Tabs>(() => load(TABS_KEY, { paths: [], active: null }));
  const [recent, setRecent] = useState<string[]>(() => load(RECENT_KEY, []));

  useEffect(() => save(TABS_KEY, tabs), [tabs]);
  useEffect(() => save(RECENT_KEY, recent), [recent]);

  const openRepo = async (dir: string) => {
    try {
      const { path } = await git.openRepo(dir); // validates and returns the repo root
      setTabs((t) => ({ paths: t.paths.includes(path) ? t.paths : [...t.paths, path], active: path }));
      setRecent((r) => [path, ...r.filter((p) => p !== path)].slice(0, 10));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: "Abrir repositório git" });
    if (typeof dir === "string") openRepo(dir);
  };

  const close = (path: string) =>
    setTabs((t) => {
      const i = t.paths.indexOf(path);
      const paths = t.paths.filter((p) => p !== path);
      const active = t.active === path ? (paths[Math.min(i, paths.length - 1)] ?? null) : t.active;
      return { paths, active };
    });

  // Ctrl+O open, Ctrl+T new tab, Ctrl+W close tab, Ctrl+Tab next tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "o") pickFolder();
      else if (k === "t") setTabs((t) => ({ ...t, active: null }));
      else if (k === "w" && tabs.active) close(tabs.active);
      else if (e.key === "Tab" && tabs.paths.length > 1) {
        const i = tabs.active ? tabs.paths.indexOf(tabs.active) : -1;
        setTabs((t) => ({ ...t, active: t.paths[(i + 1) % t.paths.length] }));
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster theme={theme} position="bottom-right" richColors />
      <div className="flex h-full flex-col bg-background">
        <nav className="flex h-10 shrink-0 items-end gap-1 border-b bg-sidebar px-2">
          <div className="mr-2 mb-1.5 grid size-7 shrink-0 place-items-center self-center rounded-md bg-primary/15 text-primary shadow-[0_0_14px_var(--glow)]">
            <GitFork className="size-4" />
          </div>
          <div className="flex min-w-0 items-end gap-1 overflow-x-auto">
            {tabs.paths.map((p) => (
              <div
                key={p}
                title={p}
                onClick={() => setTabs((t) => ({ ...t, active: p }))}
                onAuxClick={(e) => e.button === 1 && close(p)}
                className={cn(
                  "group flex h-8 max-w-52 shrink-0 cursor-pointer items-center gap-2 rounded-t-md border border-b-0 border-transparent px-3 text-muted-foreground hover:text-foreground",
                  p === tabs.active && "border-border bg-card text-foreground shadow-[inset_0_2px_0_var(--primary)]",
                )}
              >
                <FolderGit2 className="size-3.5 shrink-0" />
                <span className="truncate">{baseName(p)}</span>
                <button
                  aria-label={`Fechar ${baseName(p)}`}
                  className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    close(p);
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mb-1 shrink-0"
            aria-label="Nova aba"
            title="Nova aba (Ctrl+T)"
            onClick={() => setTabs((t) => ({ ...t, active: null }))}
          >
            <Plus />
          </Button>

          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            className="mb-1 ml-auto self-center"
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
        </nav>

        {tabs.active ? (
          // key = path: switching tabs mounts a fresh view with its own state
          <RepoView key={tabs.active} path={tabs.active} />
        ) : (
          <Home recent={recent} onOpen={openRepo} onPick={pickFolder} onForget={(p) => setRecent((r) => r.filter((x) => x !== p))} />
        )}
      </div>
    </TooltipProvider>
  );
}

type HomeProps = {
  recent: string[];
  onOpen: (path: string) => void;
  onPick: () => void;
  onForget: (path: string) => void;
};

function Home({ recent, onOpen, onPick, onForget }: HomeProps) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden p-6">
      <DotPattern className="text-primary/25 [mask-image:radial-gradient(420px_circle_at_center,white,transparent)]" />
      <div className="relative grid size-14 place-items-center rounded-xl bg-primary/15 text-primary shadow-[0_0_24px_var(--glow)]">
        <GitFork className="size-7" />
      </div>
      <div className="relative text-center">
        <h1 className="text-lg font-semibold">Abrir um repositório</h1>
        <p className="text-muted-foreground">Escolha uma pasta com git ou um repositório recente.</p>
      </div>
      <ShimmerButton
        background="var(--primary)"
        borderRadius="8px"
        shimmerColor="#c4b5ff"
        className="relative h-9 gap-2 px-4 text-sm font-medium"
        onClick={onPick}
      >
        <FolderOpen className="size-4" /> Abrir pasta (Ctrl+O)
      </ShimmerButton>
      {recent.length > 0 && (
        <div className="relative w-full max-w-md rounded-lg border bg-card p-2">
          <h3 className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">Recentes</h3>
          {recent.map((p) => (
            <div
              key={p}
              onClick={() => onOpen(p)}
              className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <FolderGit2 className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{baseName(p)}</div>
                <div className="truncate text-xs text-muted-foreground">{p}</div>
              </div>
              <button
                aria-label="Remover dos recentes"
                className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-background"
                onClick={(e) => {
                  e.stopPropagation();
                  onForget(p);
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
