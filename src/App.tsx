import { useEffect, useMemo, useState } from "react";
import {
  Code2,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  GitFork,
  Info,
  Keyboard,
  LayoutDashboard,
  Monitor,
  Moon,
  Palette,
  Plus,
  Settings as SettingsIcon,
  Sun,
  UserRound,
  UserRoundPen,
  X,
  XSquare,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dashboard } from "@/components/Dashboard";
import { RepoView } from "@/components/RepoView";
import { CommandPalette } from "@/components/CommandPalette";
import { SettingsDialog } from "@/components/Settings";
import type { PageId } from "@/components/SettingsPages";
import { dragWindow, WindowControls } from "@/components/WindowControls";
import { useSettings } from "@/hooks/use-settings";
import { splashDone } from "@/lib/splash";
import { useTheme } from "@/hooks/use-theme";
import { useCommands } from "@/lib/commands";
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
export default function App({ gitError }: { gitError: string | null }) {
  const [theme, setTheme] = useTheme();
  const [tabs, setTabs] = useState<Tabs>(() => load(TABS_KEY, { paths: [], active: null }));
  const [recent, setRecent] = useState<string[]>(() => load(RECENT_KEY, []));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<PageId>("appearance");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openSettings = (page: PageId = "appearance") => {
    setSettingsPage(page);
    setSettingsOpen(true);
  };
  const { zoom } = useSettings();

  // Never stay behind the splash: if a view doesn't report ready in time, show the app anyway
  useEffect(() => {
    const t = setTimeout(splashDone, 10_000);
    if (gitError) toast.error("Git não encontrado. Instale em git-scm.com e abra o will-repo de novo.", { duration: Infinity });
    return () => clearTimeout(t);
  }, [gitError]);

  // Zoom of the whole webview (like Ctrl+ in a browser), so pixel sizes stay consistent
  useEffect(() => {
    getCurrentWebview()
      .setZoom(zoom)
      .catch((e) => console.error(e));
  }, [zoom]);

  useEffect(() => save(TABS_KEY, tabs), [tabs]);
  useEffect(() => save(RECENT_KEY, recent), [recent]);

  // Projects on the dashboard: open tabs first, then recent ones. Memoized so the
  // dashboard only reloads when the list really changes.
  const dashboardRepos = useMemo(
    () => [...new Set([...tabs.paths, ...recent])],
    // join() turns the arrays into strings, which React compares by value
    [tabs.paths.join("|"), recent.join("|")],
  );

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

  // Commands of the shell for the palette (Ctrl+K); RepoView adds the repository ones
  useCommands("app", [
    { id: "open", title: "Abrir repositório...", group: "Geral", icon: FolderOpen, shortcut: ["Ctrl", "O"], run: pickFolder },
    {
      id: "dashboard",
      title: "Ir para o dashboard",
      group: "Geral",
      icon: LayoutDashboard,
      keywords: "inicio home nova aba",
      shortcut: ["Ctrl", "T"],
      run: () => setTabs((t) => ({ ...t, active: null })),
    },
    ...(tabs.active
      ? [{ id: "close-tab", title: "Fechar aba atual", group: "Geral", icon: XSquare, shortcut: ["Ctrl", "W"], run: () => close(tabs.active!) }]
      : []),
    ...tabs.paths
      .filter((p) => p !== tabs.active)
      .map((p) => ({
        id: `tab:${p}`,
        title: `Ir para ${baseName(p)}`,
        group: "Abas",
        icon: FolderGit2,
        keywords: p,
        run: () => setTabs((t) => ({ ...t, active: p })),
      })),
    ...recent
      .filter((p) => !tabs.paths.includes(p))
      .map((p) => ({ id: `recent:${p}`, title: `Abrir ${baseName(p)}`, group: "Recentes", icon: FolderGit2, keywords: p, run: () => openRepo(p) })),
    { id: "theme-dark", title: "Tema escuro", group: "Aparência", icon: Moon, keywords: "dark", run: () => setTheme("dark") },
    { id: "theme-light", title: "Tema claro", group: "Aparência", icon: Sun, keywords: "light", run: () => setTheme("light") },
    { id: "theme-system", title: "Tema do sistema", group: "Aparência", icon: Monitor, run: () => setTheme("system") },
    ...(
      [
        ["appearance", "Aparência", Palette],
        ["account", "Conta e GitHub", UserRound],
        ["identity", "Identidade (nome e email)", UserRoundPen],
        ["git", "Git (fetch e pull)", GitBranch],
        ["diff", "Diff", GitCompareArrows],
        ["integrations", "Editor e terminal", Code2],
        ["shortcuts", "Atalhos", Keyboard],
        ["about", "Sobre", Info],
      ] as const
    ).map(([page, title, icon]) => ({
      id: `settings:${page}`,
      title: `Configurações: ${title}`,
      group: "Configurações",
      icon,
      shortcut: page === "appearance" ? ["Ctrl", ","] : undefined,
      run: () => openSettings(page),
    })),
  ]);

  // Ctrl+O open, Ctrl+T new tab, Ctrl+W close tab, Ctrl+Tab next tab, Ctrl+, settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === ",") openSettings();
      else if (k === "k") setPaletteOpen((o) => !o);
      else if (k === "o") pickFolder();
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
        {/* Tab bar = title bar: empty areas drag the window (decorations are off in tauri.conf.json) */}
        <nav onMouseDown={dragWindow} className="flex h-10 shrink-0 items-end gap-1 border-b bg-sidebar pl-2 select-none">
          <button
            aria-label="Dashboard"
            title="Dashboard"
            onClick={() => setTabs((t) => ({ ...t, active: null }))}
            className={cn(
              "mr-2 grid size-7 shrink-0 place-items-center self-center rounded-md bg-primary/15 text-primary transition-shadow hover:shadow-[0_0_18px_var(--glow)]",
              tabs.active === null && "bg-primary text-primary-foreground shadow-[0_0_14px_var(--glow)]",
            )}
          >
            <GitFork className="size-4" />
          </button>
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
            title="Nova aba: abre o dashboard (Ctrl+T)"
            onClick={() => setTabs((t) => ({ ...t, active: null }))}
          >
            <Plus />
          </Button>
          <div onMouseDown={dragWindow} className="min-w-6 flex-1 self-stretch" />

          <Button
            variant="ghost"
            size="icon-sm"
            className="mb-1 ml-1 shrink-0 self-center text-muted-foreground hover:text-primary"
            aria-label="Configurações"
            title="Configurações (Ctrl+,)"
            onClick={() => openSettings()}
          >
            <SettingsIcon />
          </Button>
          {/* divider shorter than the bar: margin only above and below */}
          <div className="my-2.5 ml-2 w-px self-stretch bg-border" />
          <WindowControls />
        </nav>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} page={settingsPage} ctx={{ theme, setTheme }} />
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

        {tabs.active ? (
          // key = path: switching tabs mounts a fresh view with its own state
          <RepoView key={tabs.active} path={tabs.active} />
        ) : (
          <Dashboard
            repos={dashboardRepos}
            openTabs={tabs.paths}
            onOpen={openRepo}
            onPick={pickFolder}
            onForget={(p) => {
              setRecent((r) => r.filter((x) => x !== p));
              close(p);
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
