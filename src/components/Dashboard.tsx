import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  Copy,
  HardDrive,
  LogOut,
  RefreshCw,
  WifiOff,
  ArrowUp,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Mail,
  TriangleAlert,
  X,
  FolderPlus,
  GitFork,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BorderBeam } from "@/components/ui/border-beam";
import { DotPattern } from "@/components/ui/dot-pattern";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { git, relativeDate, type DeviceCode, type GithubProfile, type RepoSummary, type UserInfo } from "@/lib/git";
import { splashDone, splashStep } from "@/lib/splash";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CloneDialog } from "@/components/CloneDialog";
import { motion } from "motion/react";
import { enter } from "@/components/motion";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

/** GitHub mark (Octicons, MIT). lucide-react has no brand icons. */
export function Github({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className ?? "size-4"}>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

type Props = {
  /** open tabs first, then recent repos */
  repos: string[];
  openTabs: string[];
  onOpen: (path: string) => void;
  onPick: () => void;
  onForget: (path: string) => void;
};

type Card = { path: string; summary?: RepoSummary; error?: string };

// Start screen: who you are, how much you committed, and your projects
export function Dashboard({ repos, openTabs, onOpen, onPick, onForget }: Props) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [cards, setCards] = useState<Card[]>(() => repos.map((path) => ({ path })));
  const [cloneOpen, setCloneOpen] = useState(false);
  // bumping it reloads the cards (after "fetch all" of a group)
  const [version, setVersion] = useState(0);
  const { projectGroups: groups } = useSettings();
  const setGroups = (projectGroups: typeof groups) => updateSettings({ projectGroups });

  useEffect(() => {
    let stale = false;
    setCards(repos.map((path) => ({ path })));
    git.userInfo().then(async (u) => {
      if (stale) return;
      setUser(u);
      // one call per repo, in parallel; each card fills in when its answer arrives
      repos.forEach((path) =>
        git.repoSummary(path, u.email).then(
          (summary) => !stale && setCards((cs) => cs.map((c) => (c.path === path ? { path, summary } : c))),
          (e) => !stale && setCards((cs) => cs.map((c) => (c.path === path ? { path, error: String(e) } : c))),
        ),
      );
    });
    return () => {
      stale = true;
    };
  }, [repos, version]);

  // ---- groups (like GitKraken workspaces): a repo is in at most one group ----
  const moveTo = (path: string, group: string | null) =>
    setGroups(
      groups.map((g) => ({
        ...g,
        repos: g.name === group ? [...g.repos.filter((r) => r !== path), path] : g.repos.filter((r) => r !== path),
      })),
    );
  const newGroup = (path?: string) => {
    let n = groups.length + 1;
    while (groups.some((g) => g.name === `Grupo ${n}`)) n++;
    const name = `Grupo ${n}`;
    setGroups([...groups.map((g) => ({ ...g, repos: g.repos.filter((r) => r !== path) })), { name, repos: path ? [path] : [] }]);
  };
  const fetchAll = async (group: { name: string; repos: string[] }) => {
    const paths = group.repos.filter((p) => repos.includes(p));
    toast.info(`Fetch em ${paths.length} projeto(s) de ${group.name}...`);
    const results = await Promise.allSettled(paths.map((p) => git.fetch(p, true)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) toast.error(`${failed} fetch(es) falharam (sem internet ou sem remote)`);
    else toast.success(`${group.name}: fetch concluído`);
    setVersion((v) => v + 1);
  };
  const grouped = new Set(groups.flatMap((g) => g.repos));
  const sections = [
    ...groups.map((g) => ({ group: g, cards: cards.filter((c) => g.repos.includes(c.path)) })),
    { group: null, cards: cards.filter((c) => !grouped.has(c.path)) },
  ];

  // All of the user's commits in the last year, from every project
  const myCommits = useMemo(() => cards.flatMap((c) => c.summary?.myCommits ?? []), [cards]);
  const loading = cards.some((c) => !c.summary && !c.error);

  // Startup: the splash waits for the project cards (not for GitHub, which may be slow or offline)
  useEffect(() => splashStep("Carregando projetos", 0.6), []);
  useEffect(() => {
    if (user && !loading) splashDone();
  }, [user, loading]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <ProfileCard user={user} commits={myCommits} projects={cards.filter((c) => c.summary).length} loading={loading} />

        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Projetos</h2>
          <span className="text-xs text-muted-foreground">{cards.length} no total</span>
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => newGroup()}>
            <FolderPlus /> Novo grupo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCloneOpen(true)}>
            <GitFork /> Clonar
          </Button>
          <ShimmerButton
            background="var(--primary)"
            borderRadius="8px"
            shimmerColor="#c4b5ff"
            className="h-8 gap-2 px-3 text-sm font-medium"
            onClick={onPick}
          >
            <FolderOpen className="size-4" /> Abrir pasta (Ctrl+O)
          </ShimmerButton>
        </div>

        {cards.length === 0 ? (
          <div className="relative flex flex-col items-center gap-2 overflow-hidden rounded-xl border border-dashed p-10 text-muted-foreground">
            <DotPattern className="text-primary/20 [mask-image:radial-gradient(300px_circle_at_center,white,transparent)]" />
            <FolderGit2 className="relative size-8 text-primary" />
            <p className="relative">Nenhum projeto ainda. Abra uma pasta com git para começar.</p>
          </div>
        ) : (
          sections.map(({ group, cards: list }) =>
            // the "no group" section only shows when there are groups or loose projects
            !group && list.length === 0 ? null : (
              <section key={group?.name ?? "__none"} className="flex flex-col gap-3">
                {(group || groups.length > 0) && (
                  <GroupHeader
                    name={group?.name ?? "Sem grupo"}
                    count={list.length}
                    editable={!!group}
                    onRename={(name) => group && setGroups(groups.map((g) => (g === group ? { ...g, name } : g)))}
                    onDelete={() => group && setGroups(groups.filter((g) => g !== group))}
                    onFetchAll={group && list.length ? () => fetchAll(group) : undefined}
                  />
                )}
                {group && list.length === 0 && (
                  <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Vazio. Clique com o botão direito num projeto para movê-lo para cá.
                  </p>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                  {list.map((c, i) => (
                    <ContextMenu key={c.path}>
                      <ContextMenuTrigger asChild>
                        {/* cards come in one after the other; layout: moving between groups glides */}
                        <motion.div layout {...enter(i)}>
                          <ProjectCard card={c} open={openTabs.includes(c.path)} onOpen={() => onOpen(c.path)} onForget={() => onForget(c.path)} />
                        </motion.div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuSub>
                          <ContextMenuSubTrigger>
                            <Layers /> Mover para grupo
                          </ContextMenuSubTrigger>
                          <ContextMenuSubContent>
                            {groups.map((g) => (
                              <ContextMenuItem key={g.name} disabled={g === group} onSelect={() => moveTo(c.path, g.name)}>
                                {g.name}
                              </ContextMenuItem>
                            ))}
                            {groups.length > 0 && <ContextMenuSeparator />}
                            <ContextMenuItem onSelect={() => newGroup(c.path)}>
                              <FolderPlus /> Novo grupo
                            </ContextMenuItem>
                            {group && (
                              <ContextMenuItem onSelect={() => moveTo(c.path, null)}>
                                <X /> Tirar do grupo
                              </ContextMenuItem>
                            )}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onSelect={() => onForget(c.path)}>
                          <X /> Remover da lista
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              </section>
            ),
          )
        )}
        <CloneDialog
          open={cloneOpen}
          onOpenChange={setCloneOpen}
          // next to the user's other projects, when there are any
          suggestedParent={repos[0]?.replace(/[\\/][^\\/]+[\\/]?$/, "") ?? ""}
          onCloned={onOpen}
        />
      </div>
    </div>
  );
}

// ---------- Profile ----------

/** GitHub profile when logged in and online; otherwise local data (git config + local commits) */
export type GithubState =
  | { kind: "loading" }
  | { kind: "ok"; profile: GithubProfile }
  | { kind: "not_logged" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export function useGithub() {
  const [state, setState] = useState<GithubState>({ kind: "loading" });
  const load = () => {
    setState({ kind: "loading" });
    git.githubProfile().then(
      (profile) => setState({ kind: "ok", profile }),
      (e) => {
        const msg = String(e);
        if (msg.startsWith("not_logged")) setState({ kind: "not_logged" });
        else if (msg.startsWith("offline")) setState({ kind: "offline" });
        else setState({ kind: "error", message: msg });
      },
    );
  };
  useEffect(load, []);
  return [state, load] as const;
}

/** "2026-03-05" -> the same key countByDay uses (local date) */
const isoToKey = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d));
};

function ProfileCard({ user, commits, projects, loading }: { user: UserInfo | null; commits: number[]; projects: number; loading: boolean }) {
  const [gh, reloadGh] = useGithub();
  const [loginOpen, setLoginOpen] = useState(false);
  const profile = gh.kind === "ok" ? gh.profile : null;

  // Same heatmap and stats for both sources, only the day counts change
  const days = useMemo(
    () => (profile ? new Map(profile.days.filter(([, n]) => n > 0).map(([d, n]) => [isoToKey(d), n])) : countByDay(commits)),
    [profile, commits],
  );
  const stats = useMemo(() => streaks(days), [days]);
  const lastWeek = useMemo(() => {
    let n = 0;
    const d = new Date();
    for (let i = 0; i < 7; i++, d.setDate(d.getDate() - 1)) n += days.get(dayKey(d)) ?? 0;
    return n;
  }, [days]);
  const total = profile ? profile.totalContributions : commits.length;
  const busy = profile ? false : loading || gh.kind === "loading";

  const logout = async () => {
    await git.githubLogout();
    reloadGh();
  };

  return (
    <section className="relative overflow-hidden rounded-xl border bg-card p-6 shadow-[0_0_40px_-12px_var(--glow)]">
      <BorderBeam size={120} duration={10} colorFrom="var(--primary)" colorTo="var(--lane-2)" />
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={profile?.name ?? user?.name} email={user?.email} url={profile?.avatarUrl} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">
            {profile?.name ?? profile?.login ?? user?.name ?? (user ? "Sem nome configurado" : "...")}
          </h1>
          {profile ? (
            <>
              <button
                className="flex items-center gap-1.5 text-muted-foreground hover:text-primary"
                onClick={() => openUrl(profile.url)}
              >
                <Github className="size-3.5" /> @{profile.login}
              </button>
              {profile.bio && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{profile.bio}</p>}
              <p className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  <b className="text-foreground">{profile.followers}</b> seguidores
                </span>
                <span>
                  <b className="text-foreground">{profile.following}</b> seguindo
                </span>
                <span>
                  <b className="text-foreground">{profile.repositories}</b> repositórios
                </span>
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Mail className="size-3.5" /> {user?.email ?? "sem email"}
              </p>
              {user && (!user.name || !user.email) && (
                <p className="mt-1 text-xs text-warning">
                  Configure com <code>git config --global user.name "Seu Nome"</code> e <code>user.email</code>
                </p>
              )}
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Stat label="Contribuições no ano" value={total} loading={busy} />
          <Stat label="Últimos 7 dias" value={lastWeek} loading={busy} />
          <Stat label="Sequência atual" value={stats.current} unit="dias" loading={busy} />
          <Stat label="Maior sequência" value={stats.longest} unit="dias" loading={busy} />
        </div>
      </div>

      <div className="mt-6">
        <Heatmap
          days={days}
          caption={
            profile
              ? `${total} contribuições no GitHub no último ano`
              : `${total} commits seus no último ano, em ${projects} projeto(s) local(is)`
          }
        />
      </div>

      {/* where the data comes from + login/logout */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        {gh.kind === "ok" && (
          <>
            <Github className="size-3.5" />
            {gh.profile.source === "gh" ? "Conectado ao GitHub pelo gh CLI" : "Conectado ao GitHub"}
            {gh.profile.source === "app" && (
              <Button variant="ghost" size="xs" className="ml-auto" onClick={logout}>
                <LogOut /> Sair
              </Button>
            )}
          </>
        )}
        {gh.kind === "loading" && (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Conectando ao GitHub...
          </>
        )}
        {gh.kind === "not_logged" && (
          <>
            <HardDrive className="size-3.5" /> Dados locais (git config + commits dos projetos)
            <Button size="xs" className="ml-auto" onClick={() => setLoginOpen(true)}>
              <Github /> Entrar com GitHub
            </Button>
          </>
        )}
        {(gh.kind === "offline" || gh.kind === "error") && (
          <>
            {gh.kind === "offline" ? <WifiOff className="size-3.5" /> : <TriangleAlert className="size-3.5 text-warning" />}
            {gh.kind === "offline" ? "Sem internet: mostrando dados locais" : gh.message}
            <Button variant="ghost" size="xs" className="ml-auto" onClick={reloadGh}>
              <RefreshCw /> Tentar de novo
            </Button>
          </>
        )}
      </div>

      <GithubLogin
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onDone={() => {
          setLoginOpen(false);
          reloadGh();
        }}
      />
    </section>
  );
}

/** Device Flow: show the code, open github.com/login/device, wait for the user to authorize */
export function GithubLogin({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    setCode(null);
    setError(null);

    git.githubDeviceStart().then(
      (c) => {
        if (stop) return;
        setCode(c);
        let wait = c.interval * 1000;
        // ask GitHub every `interval` seconds until the user authorizes (like a TTimer)
        const poll = () =>
          git.githubDevicePoll(c.deviceCode).then(
            (r) => {
              if (stop) return;
              if (r === "done") return onDone();
              if (r === "slow_down") wait += 5000;
              timer = setTimeout(poll, wait);
            },
            (e) => !stop && setError(String(e)),
          );
        timer = setTimeout(poll, wait);
      },
      (e) => !stop && setError(String(e)),
    );
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // onDone is a new function each render; restart only when the dialog opens
  }, [open]);

  const copyAndOpen = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code.userCode);
    toast.success("Código copiado");
    openUrl(code.verificationUri);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-4" /> Entrar com GitHub
          </DialogTitle>
          <DialogDescription>Digite o código abaixo no GitHub e autorize o will-repo.</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-destructive">{error}</p>
            <p className="text-muted-foreground">
              Alternativa: rode <code>gh auth login</code> no terminal. O app usa o login do gh CLI automaticamente.
            </p>
          </div>
        ) : !code ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <code className="rounded-lg border bg-sidebar px-4 py-2 text-2xl font-semibold tracking-[0.3em] text-primary">
              {code.userCode}
            </code>
            <Button onClick={copyAndOpen}>
              <Copy /> Copiar código e abrir GitHub
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Aguardando autorização...
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, unit, loading }: { label: string; value: number; unit?: string; loading: boolean }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">
        {loading && value === 0 ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Gravatar photo by email; initials when there is none (or offline) */
export function Avatar({
  name,
  email,
  url: direct,
  className,
}: {
  name?: string | null;
  email?: string | null;
  url?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (direct) return setUrl(direct);
    if (!email) return setUrl(null);
    // Gravatar identifies the account by the SHA-256 of the email (the email itself is not sent)
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())).then((buf) => {
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      setUrl(`https://gravatar.com/avatar/${hex}?s=160&d=404`);
    });
  }, [email, direct]);

  const initials = (name ?? email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <div
      className={cn(
        "grid size-18 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 text-2xl font-semibold text-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-card",
        className,
      )}
    >
      {url && !failed ? <img src={url} alt="" className="size-full object-cover" onError={() => setFailed(true)} /> : initials}
    </div>
  );
}

// ---------- Contribution heatmap ----------

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export function countByDay(times: number[]) {
  const map = new Map<string, number>();
  for (const t of times) {
    const k = dayKey(new Date(t * 1000));
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/** Days in a row with commits: ending today (or yesterday), and the longest in the year */
export function streaks(days: Map<string, number>) {
  let longest = 0;
  let run = 0;
  const d = new Date();
  d.setDate(d.getDate() - 365);
  for (let i = 0; i <= 365; i++, d.setDate(d.getDate() + 1)) {
    run = days.has(dayKey(d)) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // today without commits yet doesn't break the current streak
  const today = new Date();
  const current = days.has(dayKey(today)) ? run : (() => {
    let n = 0;
    const y = new Date();
    for (y.setDate(y.getDate() - 1); days.has(dayKey(y)); y.setDate(y.getDate() - 1)) n++;
    return n;
  })();
  return { current, longest };
}

const level = (n: number) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
const CELL = 12;
const GAP = 3;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// GitHub-style grid: one column per week (Sunday on top), 53 weeks back from today
function Heatmap({ days, caption }: { days: Map<string, number>; caption: string }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const weeks = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay() - 52 * 7); // Sunday, 52 weeks ago
    const today = new Date();
    const cols: { date: Date; count: number; future: boolean }[][] = [];
    for (let w = 0; w < 53; w++) {
      cols.push(
        Array.from({ length: 7 }, (_, d) => {
          const date = new Date(start);
          date.setDate(start.getDate() + w * 7 + d);
          return { date, count: days.get(dayKey(date)) ?? 0, future: date > today };
        }),
      );
    }
    return cols;
  }, [days]);

  return (
    <div className="relative">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-medium">Contribuições</h3>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex gap-2">
          {/* weekday labels */}
          <div className="grid pt-5 text-[10px] text-muted-foreground" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}>
            {["", "seg", "", "qua", "", "sex", ""].map((d, i) => (
              <span key={i} className="leading-3">
                {d}
              </span>
            ))}
          </div>
          <div>
            {/* month labels: shown on the first week of each month */}
            <div className="relative mb-1 h-4 text-[10px] text-muted-foreground">
              {weeks.map((w, i) => {
                const first = w[0].date;
                const isStart = first.getDate() <= 7 && i > 0;
                return isStart ? (
                  <span key={i} className="absolute" style={{ left: i * (CELL + GAP) }}>
                    {MONTHS[first.getMonth()]}
                  </span>
                ) : null;
              })}
            </div>
            <div className="flex" style={{ gap: GAP }} onMouseLeave={() => setHover(null)}>
              {weeks.map((w, i) => (
                <div key={i} className="flex flex-col" style={{ gap: GAP }}>
                  {w.map(({ date, count, future }) => {
                    const text = `${count === 0 ? "Nenhum commit" : `${count} commit${count > 1 ? "s" : ""}`} em ${date.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}`;
                    return (
                      <div
                        key={date.toISOString()}
                        role="img"
                        aria-label={text}
                        onMouseEnter={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          const box = e.currentTarget.closest(".relative")!.getBoundingClientRect();
                          setHover({ x: r.left - box.left + CELL / 2, y: r.top - box.top, text });
                        }}
                        className={cn("rounded-[3px]", future ? "invisible" : "hover:ring-1 hover:ring-foreground/50")}
                        style={{ width: CELL, height: CELL, background: `var(--heat-${level(count)})` }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        Menos
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="rounded-[3px]" style={{ width: CELL, height: CELL, background: `var(--heat-${l})` }} />
        ))}
        Mais
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}

// ---------- Project card ----------

function ProjectCard({ card, open, onOpen, onForget }: { card: Card; open: boolean; onOpen: () => void; onForget: () => void }) {
  const s = card.summary;
  const name = s?.name ?? card.path.split(/[\\/]/).filter(Boolean).pop();

  return (
    <div
      onClick={card.error ? undefined : onOpen}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-all",
        !card.error && "cursor-pointer hover:border-primary/50 hover:shadow-[0_0_24px_-8px_var(--glow)]",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <FolderGit2 className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{name}</span>
            {open && <span className="size-1.5 shrink-0 rounded-full bg-success" title="Aberto em uma aba" />}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={card.path}>
            {card.path}
          </div>
        </div>
        <button
          aria-label="Remover dos projetos"
          title="Remover da lista (não apaga nada)"
          className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onForget();
          }}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {card.error ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" /> {card.error}
        </p>
      ) : !s ? (
        <div className="flex h-[88px] items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="gap-1 font-mono">
              <GitBranch /> {s.head ?? "HEAD destacado"}
            </Badge>
            {s.changes > 0 && (
              <Badge variant="outline" className="border-warning/50 text-warning">
                {s.changes} alteraç{s.changes > 1 ? "ões" : "ão"}
              </Badge>
            )}
            {(s.ahead > 0 || s.behind > 0) && (
              <Badge variant="outline" className="gap-1.5">
                <span className="flex items-center">
                  <ArrowUp className="size-3" />
                  {s.ahead}
                </span>
                <span className="flex items-center">
                  <ArrowDown className="size-3" />
                  {s.behind}
                </span>
              </Badge>
            )}
          </div>
          <div className="min-h-9 text-xs">
            {s.lastCommit ? (
              <>
                <div className="truncate" title={s.lastCommit.subject}>
                  {s.lastCommit.subject}
                </div>
                <div className="text-muted-foreground">
                  {s.lastCommit.author} · {relativeDate(s.lastCommit.timestamp)}
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">Sem commits ainda</span>
            )}
          </div>
          <div className="flex items-end justify-between gap-3 border-t pt-3">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitCommitHorizontal className="size-3.5" /> {s.totalCommits} commits
            </span>
            <Sparkline times={s.myCommits} />
          </div>
        </>
      )}
    </div>
  );
}

/** The user's commits per week, last 12 weeks, as small bars */
function Sparkline({ times }: { times: number[] }) {
  const weeks = 12;
  const now = Date.now() / 1000;
  const counts = Array.from({ length: weeks }, (_, i) => {
    const end = now - (weeks - 1 - i) * 7 * 86400;
    return times.filter((t) => t > end - 7 * 86400 && t <= end).length;
  });
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="h-3 text-[10px] text-muted-foreground tabular-nums">
        {hover === null
          ? `${total} seus em 12 semanas`
          : `${counts[hover]} na semana de ${new Date((now - (weeks - hover) * 7 * 86400) * 1000).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}`}
      </span>
      <div className="flex h-7 items-end gap-0.5" onMouseLeave={() => setHover(null)}>
        {counts.map((n, i) => (
          // the hit area is the full column, bigger than the bar itself
          <div key={i} className="flex h-full w-2 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className={cn("w-full rounded-t-[2px]", n === 0 ? "bg-muted" : "bg-primary", hover === i && "brightness-125")}
              style={{ height: n === 0 ? 2 : `${Math.max(15, (n / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Title of a project group: rename by clicking, fetch everything, delete */
function GroupHeader({
  name,
  count,
  editable,
  onRename,
  onDelete,
  onFetchAll,
}: {
  name: string;
  count: number;
  editable: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onFetchAll?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const save = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim());
    else setDraft(name);
  };
  return (
    <div className="group flex items-center gap-2 border-b pb-2">
      <Layers className="size-4 text-primary" />
      {editing ? (
        <input
          autoFocus
          className="rounded border bg-background px-1.5 text-sm font-semibold outline-none focus:border-primary"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h3 className="text-sm font-semibold">{name}</h3>
      )}
      <span className="text-xs text-muted-foreground">{count}</span>
      <div className="ml-auto flex gap-1 opacity-60 group-hover:opacity-100">
        {onFetchAll && (
          <Button variant="ghost" size="xs" onClick={onFetchAll} title="Fetch em todos os projetos do grupo">
            <RefreshCw /> Fetch em todos
          </Button>
        )}
        {editable && (
          <>
            <Button variant="ghost" size="icon-xs" title="Renomear" aria-label="Renomear" onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-xs" className="text-destructive" title="Apagar o grupo (os projetos continuam)" aria-label="Apagar grupo" onClick={onDelete}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
