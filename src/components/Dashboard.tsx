import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Mail,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BorderBeam } from "@/components/ui/border-beam";
import { DotPattern } from "@/components/ui/dot-pattern";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { git, relativeDate, type RepoSummary, type UserInfo } from "@/lib/git";
import { cn } from "@/lib/utils";

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
  }, [repos]);

  // All of the user's commits in the last year, from every project
  const myCommits = useMemo(() => cards.flatMap((c) => c.summary?.myCommits ?? []), [cards]);
  const loading = cards.some((c) => !c.summary && !c.error);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <ProfileCard user={user} commits={myCommits} projects={cards.filter((c) => c.summary).length} loading={loading} />

        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Projetos</h2>
          <span className="text-xs text-muted-foreground">{cards.length} no total</span>
          <ShimmerButton
            background="var(--primary)"
            borderRadius="8px"
            shimmerColor="#c4b5ff"
            className="ml-auto h-8 gap-2 px-3 text-sm font-medium"
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {cards.map((c) => (
              <ProjectCard
                key={c.path}
                card={c}
                open={openTabs.includes(c.path)}
                onOpen={() => onOpen(c.path)}
                onForget={() => onForget(c.path)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Profile ----------

function ProfileCard({ user, commits, projects, loading }: { user: UserInfo | null; commits: number[]; projects: number; loading: boolean }) {
  const days = useMemo(() => countByDay(commits), [commits]);
  const stats = useMemo(() => streaks(days), [days]);
  const weekAgo = Date.now() / 1000 - 7 * 86400;

  return (
    <section className="relative overflow-hidden rounded-xl border bg-card p-6 shadow-[0_0_40px_-12px_var(--glow)]">
      <BorderBeam size={120} duration={10} colorFrom="var(--primary)" colorTo="var(--lane-2)" />
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={user?.name} email={user?.email} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{user?.name ?? (user ? "Sem nome configurado" : "...")}</h1>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="size-3.5" /> {user?.email ?? "sem email"}
          </p>
          {user && (!user.name || !user.email) && (
            <p className="mt-1 text-xs text-warning">
              Configure com <code>git config --global user.name "Seu Nome"</code> e <code>user.email</code>
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Stat label="Contribuições no ano" value={commits.length} loading={loading} />
          <Stat label="Últimos 7 dias" value={commits.filter((t) => t >= weekAgo).length} loading={loading} />
          <Stat label="Sequência atual" value={stats.current} unit="dias" loading={loading} />
          <Stat label="Maior sequência" value={stats.longest} unit="dias" loading={loading} />
        </div>
      </div>
      <div className="mt-6">
        <Heatmap days={days} total={commits.length} projects={projects} />
      </div>
    </section>
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
function Avatar({ name, email }: { name?: string | null; email?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!email) return setUrl(null);
    // Gravatar identifies the account by the SHA-256 of the email (the email itself is not sent)
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())).then((buf) => {
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      setUrl(`https://gravatar.com/avatar/${hex}?s=160&d=404`);
    });
  }, [email]);

  const initials = (name ?? email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <div className="grid size-18 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 text-2xl font-semibold text-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-card">
      {url && !failed ? <img src={url} alt="" className="size-full object-cover" onError={() => setFailed(true)} /> : initials}
    </div>
  );
}

// ---------- Contribution heatmap ----------

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function countByDay(times: number[]) {
  const map = new Map<string, number>();
  for (const t of times) {
    const k = dayKey(new Date(t * 1000));
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/** Days in a row with commits: ending today (or yesterday), and the longest in the year */
function streaks(days: Map<string, number>) {
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
function Heatmap({ days, total, projects }: { days: Map<string, number>; total: number; projects: number }) {
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
        <span className="text-xs text-muted-foreground">
          {total} commits seus no último ano, em {projects} projeto(s)
        </span>
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
