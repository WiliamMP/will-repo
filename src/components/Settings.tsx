import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, Search, X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/motion";
import { Slider } from "@/components/ui/slider";
import { Avatar, useGithub } from "@/components/Dashboard";
import { PAGES, type PageId, type SettingsContext } from "@/components/SettingsPages";
import { git, type UserInfo } from "@/lib/git";
import { cn } from "@/lib/utils";

const GROUPS = ["Geral", "Experiência", "Sistema"] as const;
export type Group = (typeof GROUPS)[number];

export type Page = {
  id: PageId;
  title: string;
  icon: LucideIcon;
  group: Group;
  /** shown under the active page in the sidebar; ids match <Section id> */
  sections: { id: string; title: string }[];
  /** extra words the search should find */
  keywords: string;
  render: (ctx: SettingsContext) => ReactNode;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** page to show when opening */
  page?: PageId;
  ctx: Omit<SettingsContext, "goTo">;
};

// "café" and "cafe" match each other
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Settings in the style of Discord's: big modal, grouped sidebar with search,
// the active page expands into its sections and follows the scroll.
export function SettingsDialog({ open, onOpenChange, page: initial = "appearance", ctx }: Props) {
  const [pageId, setPageId] = useState<PageId>(initial);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const page = PAGES.find((p) => p.id === pageId)!;

  useEffect(() => {
    if (open) {
      setPageId(initial);
      setQuery("");
    }
  }, [open, initial]);

  const goTo = (id: PageId, sectionId?: string) => {
    setPageId(id);
    setQuery("");
    // wait for the new page to render, then jump to the section
    requestAnimationFrame(() => {
      const el = sectionId && document.getElementById(`settings-${sectionId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else scrollRef.current?.scrollTo({ top: 0 });
    });
  };

  // Scroll spy: the active section is the last one whose top has passed the top of the view
  const spy = () => {
    const box = scrollRef.current;
    if (!box) return;
    let current = page.sections[0]?.id ?? null;
    for (const s of page.sections) {
      const el = document.getElementById(`settings-${s.id}`);
      if (el && el.getBoundingClientRect().top - box.getBoundingClientRect().top < 96) current = s.id;
    }
    // at the very bottom the last section wins even if it is short
    if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 4) current = page.sections[page.sections.length - 1]?.id ?? current;
    setSection(current);
  };
  useEffect(spy, [pageId]);

  const results = useMemo(() => {
    const q = plain(query.trim());
    if (!q) return PAGES;
    return PAGES.filter((p) => plain([p.title, p.keywords, ...p.sections.map((s) => s.title)].join(" ")).includes(q));
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // focus the search (Radix would focus the first button)
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
        className="grid h-[min(780px,90vh)] w-[min(1100px,94vw)] max-w-none grid-cols-[250px_1fr] gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Configurações</DialogTitle>
        <DialogDescription className="sr-only">Preferências do will-repo</DialogDescription>

        <aside className="flex min-h-0 flex-col border-r bg-sidebar">
          <ProfileHeader onEdit={() => goTo("identity")} />
          <div className="relative px-3 pb-3">
            <Search className="absolute top-1/2 left-5.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Buscar"
              className="h-8 bg-background pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation(); // clear the search instead of closing the dialog
                  setQuery("");
                } else if (e.key === "Enter" && results[0]) goTo(results[0].id);
              }}
            />
            {query && (
              <button
                aria-label="Limpar busca"
                className="absolute top-1/2 right-5 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {results.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">Nada encontrado.</p>}
            {GROUPS.map((group, gi) => {
              const pages = results.filter((p) => p.group === group);
              if (!pages.length) return null;
              return (
                <div key={group} className={cn(gi > 0 && "mt-3 border-t pt-3")}>
                  <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                    {group}
                  </h3>
                  {pages.map((p) => {
                    const active = p.id === pageId;
                    return (
                      <div key={p.id}>
                        <button
                          onClick={() => goTo(p.id)}
                          className={cn(
                            "relative isolate flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                            active && "font-medium text-sidebar-accent-foreground hover:bg-transparent",
                          )}
                        >
                          {/* the highlight slides from the previous page to this one */}
                          {active && (
                            <motion.span
                              layoutId="settings-nav"
                              className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent shadow-[inset_2px_0_0_var(--primary)]"
                            />
                          )}
                          <p.icon className={cn("size-4 shrink-0", active && "text-primary")} />
                          {p.title}
                        </button>
                        {/* the active page lists its sections, like Discord */}
                        {active && !query && p.sections.length > 1 && (
                          <div className="my-1 ml-4 flex flex-col border-l">
                            {p.sections.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => goTo(p.id, s.id)}
                                className={cn(
                                  "relative -ml-px py-1 pl-4 text-left text-[13px] text-muted-foreground hover:text-foreground",
                                  section === s.id && "text-foreground",
                                )}
                              >
                                {/* the bar follows the section in view while scrolling */}
                                {section === s.id && (
                                  <motion.span layoutId="settings-section" className="absolute inset-y-0.5 left-0 w-0.5 rounded-full bg-primary shadow-[0_0_6px_var(--glow)]" />
                                )}
                                {s.title}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <Footer />
        </aside>

        <section className="flex min-h-0 flex-col bg-background">
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <page.icon className="size-4 text-primary" /> {page.title}
            </h2>
            <button
              aria-label="Fechar (Esc)"
              title="Fechar (Esc)"
              onClick={() => onOpenChange(false)}
              className="grid size-7 place-items-center rounded-full border text-muted-foreground transition-shadow hover:text-foreground hover:shadow-[0_0_14px_var(--glow)]"
            >
              <X className="size-4" />
            </button>
          </header>
          <div ref={scrollRef} onScroll={spy} className="min-h-0 flex-1 overflow-y-auto">
            <FadeIn key={pageId} className="mx-auto flex max-w-2xl flex-col px-8 pt-8 pb-24">
              {page.render({ ...ctx, goTo })}
            </FadeIn>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function ProfileHeader({ onEdit }: { onEdit: () => void }) {
  const [gh] = useGithub();
  const [user, setUser] = useState<UserInfo | null>(null);
  useEffect(() => {
    git.userInfo().then(setUser, () => {});
  }, []);
  const profile = gh.kind === "ok" ? gh.profile : null;
  return (
    <div className="flex items-center gap-3 p-4">
      <Avatar
        name={profile?.name ?? user?.name}
        email={user?.email}
        url={profile?.avatarUrl}
        className="size-10 text-sm ring-offset-sidebar"
      />
      <div className="min-w-0">
        <p className="truncate font-semibold">{profile?.name ?? user?.name ?? "Sem nome"}</p>
        <button className="text-xs text-muted-foreground hover:text-primary" onClick={onEdit}>
          Editar identidade
        </button>
      </div>
    </div>
  );
}

function Footer() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);
  return (
    <p className="border-t px-5 py-3 font-mono text-[11px] text-muted-foreground/70">
      will-repo {version && `v${version}`} · Ctrl+,
    </p>
  );
}

// ---------- Building blocks for the pages ----------

/** Titled block of a page; `id` is what the sidebar links and the scroll spy use */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={`settings-${id}`} className="scroll-mt-6 border-b py-8 first:pt-0 last:border-0">
      <h3 className="text-xl font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5 flex flex-col gap-1">{children}</div>
    </section>
  );
}

/** One setting: label and help on the left, the control on the right */
export function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** "Configurações relacionadas": a card that jumps to another page */
export function Related({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-2">
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">Relacionado</p>
      <button
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-shadow hover:border-primary/50 hover:shadow-[0_0_20px_-6px_var(--glow)]"
      >
        <span className="grid size-9 place-items-center rounded-md bg-primary/15 text-primary">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{description}</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
    </div>
  );
}

/** Slider that snaps to labeled stops (like Discord's text size) */
export function StopSlider({
  value,
  stops,
  format,
  onChange,
}: {
  value: number;
  stops: number[];
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  // the slider moves over the stop indexes, so uneven stops are evenly spaced
  const index = stops.reduce((best, s, i) => (Math.abs(s - value) < Math.abs(stops[best] - value) ? i : best), 0);
  const left = (i: number) => `${(i / (stops.length - 1)) * 100}%`;
  return (
    <div className="px-1.5 pt-2 pb-7">
      <div className="relative">
        <Slider
          aria-label="Valor"
          min={0}
          max={stops.length - 1}
          step={1}
          value={[index]}
          onValueChange={([i]) => onChange(stops[i])}
        />
        {stops.map((s, i) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            style={{ left: left(i) }}
            className={cn(
              "absolute top-4 -translate-x-1/2 font-mono text-[11px] text-muted-foreground hover:text-foreground",
              i === index && "text-primary",
            )}
          >
            {format(s)}
          </button>
        ))}
      </div>
    </div>
  );
}
