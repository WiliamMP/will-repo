import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, History as HistoryIcon, Loader2, Search, Undo2, UserRoundSearch, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { isImage } from "@/components/ImageDiff";
import { git, relativeDate, type BlameLine, type Commit } from "@/lib/git";
import { cn } from "@/lib/utils";

export type BrowserTab = "content" | "blame" | "history";
export type BrowserTarget = { rev: string; path?: string; tab?: BrowserTab };

type Props = {
  repo: string;
  /** null = closed */
  target: BrowserTarget | null;
  onClose: () => void;
  /** select a commit in the main history (closes the browser) */
  onSelectCommit: (hash: string) => void;
};

const short = (rev: string) => (/^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev);

// Every file of the repository as it was in any commit: folder tree, content,
// blame (who changed each line) and the file's own history
export function FileBrowser({ repo, target, onClose, onSelectCommit }: Props) {
  const [rev, setRev] = useState("HEAD");
  const [files, setFiles] = useState<string[] | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [tab, setTab] = useState<BrowserTab>("content");
  const [filter, setFilter] = useState("");

  // Opening: start where the caller asked
  useEffect(() => {
    if (!target) return;
    setRev(target.rev);
    setPath(target.path ?? null);
    setTab(target.tab ?? "content");
    setFilter("");
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let stale = false;
    setFiles(null);
    git.tree(repo, rev).then(
      (f) => !stale && setFiles(f),
      (e) => toast.error(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [repo, rev, target]);

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="grid h-[min(820px,92vh)] w-[min(1240px,96vw)] max-w-none grid-cols-[280px_1fr] gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Arquivos</DialogTitle>
        <DialogDescription className="sr-only">Arquivos do repositório em um commit</DialogDescription>

        <aside className="flex min-h-0 flex-col border-r bg-sidebar">
          <div className="flex items-center gap-2 px-4 pt-4 pb-3">
            <FolderOpen className="size-4 text-primary" />
            <span className="font-semibold">Arquivos em</span>
            <code className="rounded bg-primary/15 px-1.5 text-xs text-primary">{short(rev)}</code>
            {target && rev !== target.rev && (
              <button
                title={`Voltar para ${short(target.rev)}`}
                className="ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => setRev(target.rev)}
              >
                <Undo2 className="size-3.5" />
              </button>
            )}
          </div>
          <div className="relative px-3 pb-3">
            <Search className="absolute top-1/2 left-5.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Filtrar arquivos"
              className="h-8 bg-background pl-8"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {!files ? (
              <Loader2 className="mx-auto mt-4 size-4 animate-spin text-primary" />
            ) : (
              <Tree files={files} filter={filter} selected={path} onSelect={setPath} />
            )}
          </div>
        </aside>

        {/* min-w-0: a long code line must scroll inside, not widen the dialog */}
        <section className="flex min-h-0 min-w-0 flex-col bg-background">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
            <span className="min-w-0 flex-1 truncate font-mono text-sm" title={path ?? ""}>
              {path ?? <span className="font-sans text-muted-foreground">Escolha um arquivo</span>}
            </span>
            {path && (
              <div className="flex rounded-lg border p-0.5">
                {(
                  [
                    ["content", File, "Conteúdo"],
                    ["blame", UserRoundSearch, "Blame"],
                    ["history", HistoryIcon, "Histórico"],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <button
                    key={value}
                    onClick={() => setTab(value)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground",
                      tab === value && "bg-accent text-accent-foreground shadow-[inset_0_-2px_0_var(--primary)]",
                    )}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
            )}
            <button
              aria-label="Fechar"
              onClick={onClose}
              className="grid size-7 place-items-center rounded-full border text-muted-foreground hover:text-foreground hover:shadow-[0_0_14px_var(--glow)]"
            >
              <X className="size-4" />
            </button>
          </header>
          {!path && (
            <div className="grid min-h-0 flex-1 place-items-center bg-sidebar text-sm text-muted-foreground">
              <p className="flex flex-col items-center gap-2">
                <FolderOpen className="size-8 text-primary/60" />
                Escolha um arquivo na árvore
              </p>
            </div>
          )}
          {path &&
            (tab === "content" ? (
              <Content key={`${rev}:${path}`} repo={repo} rev={rev} path={path} />
            ) : tab === "blame" ? (
              <Blame key={`${rev}:${path}`} repo={repo} rev={rev} path={path} onSelectCommit={onSelectCommit} />
            ) : (
              <FileHistory
                key={path}
                repo={repo}
                path={path}
                current={rev}
                onOpen={(hash) => {
                  setRev(hash);
                  setTab("content");
                }}
                onSelectCommit={onSelectCommit}
              />
            ))}
        </section>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Folder tree ----------

type Node = { name: string; path: string; children: Map<string, Node>; file: boolean };

function buildTree(files: string[]): Node {
  const root: Node = { name: "", path: "", children: new Map(), file: false };
  for (const f of files) {
    let node = root;
    f.split("/").forEach((part, i, parts) => {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map(), file: i === parts.length - 1 });
      node = node.children.get(part)!;
    });
  }
  return root;
}

function Tree({ files, filter, selected, onSelect }: { files: string[]; filter: string; selected: string | null; onSelect: (p: string) => void }) {
  const root = useMemo(() => buildTree(files), [files]);
  // folders of the selected file start open
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!selected) return;
    const parts = selected.split("/");
    setOpen((o) => new Set([...o, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))]));
  }, [selected]);

  const q = filter.trim().toLowerCase();
  if (q) {
    // filtering: a flat list of matching paths is easier to scan than a tree
    const hits = files.filter((f) => f.toLowerCase().includes(q)).slice(0, 500);
    return (
      <>
        {hits.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Nada encontrado.</p>}
        {hits.map((f) => (
          <Item key={f} depth={0} active={f === selected} onClick={() => onSelect(f)} icon={<File className="size-3.5 shrink-0" />}>
            <span className="truncate" title={f}>
              {f}
            </span>
          </Item>
        ))}
      </>
    );
  }

  const render = (node: Node, depth: number): ReactNode =>
    // folders first, then files, each alphabetically
    [...node.children.values()]
      .sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name))
      .map((n) =>
        n.file ? (
          <Item key={n.path} depth={depth} active={n.path === selected} onClick={() => onSelect(n.path)} icon={<File className="size-3.5 shrink-0" />}>
            <span className="truncate">{n.name}</span>
          </Item>
        ) : (
          <div key={n.path}>
            <Item
              depth={depth}
              onClick={() =>
                setOpen((o) => {
                  const next = new Set(o);
                  if (!next.delete(n.path)) next.add(n.path);
                  return next;
                })
              }
              icon={
                <>
                  {open.has(n.path) ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
                  <Folder className="size-3.5 shrink-0 text-primary/80" />
                </>
              }
            >
              <span className="truncate">{n.name}</span>
            </Item>
            {open.has(n.path) && render(n, depth + 1)}
          </div>
        ),
      );
  return <>{render(root, 0)}</>;
}

function Item({ depth, active, onClick, icon, children }: { depth: number; active?: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--primary)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------- Content ----------

function useBlob(repo: string, rev: string, path: string) {
  const [buf, setBuf] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let stale = false;
    git.blob(repo, rev, path).then(
      (b) => !stale && setBuf(b),
      (e) => toast.error(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [repo, rev, path]);
  return buf;
}

function Content({ repo, rev, path }: { repo: string; rev: string; path: string }) {
  const buf = useBlob(repo, rev, path);
  const [url, setUrl] = useState<string | null>(null);
  const image = isImage(path);

  useEffect(() => {
    if (!buf || !image) return;
    const u = URL.createObjectURL(new Blob([buf], { type: path.endsWith(".svg") ? "image/svg+xml" : "" }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [buf, image, path]);

  const lines = useMemo(() => {
    if (!buf || image) return null;
    const bytes = new Uint8Array(buf);
    // a NUL byte in the beginning means a binary file (same rule git uses)
    if (bytes.subarray(0, 8000).includes(0)) return null;
    return new TextDecoder().decode(bytes).replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  }, [buf, image]);

  if (!buf) return <Loading />;
  if (image)
    return (
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-sidebar p-6">
        {url && <img src={url} alt={path} className="max-w-full rounded-lg border bg-[length:16px_16px] bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)]" />}
      </div>
    );
  if (!lines) return <p className="p-4 text-sm text-muted-foreground">Arquivo binário ({buf.byteLength} bytes).</p>;
  return <Lines count={lines.length} longest={lines.reduce((m, l) => Math.max(m, l.length), 20)} render={(i) => <CodeLine n={i + 1} text={lines[i]} />} />;
}

const CodeLine = ({ n, text }: { n: number; text: string }) => (
  <>
    <span className="w-14 shrink-0 pr-3 text-right text-muted-foreground/60 select-none">{n}</span>
    <span className="pr-4 whitespace-pre">{text}</span>
  </>
);

/** Virtual list of fixed-height code lines (only the visible ones are in the DOM) */
function Lines({ count, longest, render, gutter = 0 }: { count: number; longest: number; render: (i: number) => ReactNode; gutter?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count, getScrollElement: () => ref.current, estimateSize: () => 20, overscan: 30 });
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto bg-sidebar">
      <div
        className="relative font-mono text-xs leading-5"
        style={{ height: virtual.getTotalSize() + 16, minWidth: `calc(${gutter}px + 3.5rem + ${longest + 4}ch)` }}
      >
        {virtual.getVirtualItems().map((item) => (
          <div key={item.key} className="absolute top-0 left-0 flex h-5 w-full" style={{ transform: `translateY(${item.start + 8}px)` }}>
            {render(item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

const Loading = () => (
  <div className="grid min-h-0 flex-1 place-items-center bg-sidebar">
    <Loader2 className="size-5 animate-spin text-primary" />
  </div>
);

// ---------- Blame ----------

function Blame({ repo, rev, path, onSelectCommit }: { repo: string; rev: string; path: string; onSelectCommit: (h: string) => void }) {
  const [lines, setLines] = useState<BlameLine[] | null>(null);
  useEffect(() => {
    let stale = false;
    git.blame(repo, rev, path).then(
      (l) => !stale && setLines(l),
      (e) => toast.error(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [repo, rev, path]);

  // one color per commit, so blocks of the same change stand out
  const colors = useMemo(() => {
    const map = new Map<string, number>();
    lines?.forEach((l) => map.has(l.hash) || map.set(l.hash, map.size % 6));
    return map;
  }, [lines]);

  if (!lines) return <Loading />;
  const GUTTER = 300;
  return (
    <Lines
      count={lines.length}
      gutter={GUTTER}
      longest={lines.reduce((m, l) => Math.max(m, l.text.length), 20)}
      render={(i) => {
        const l = lines[i];
        const first = i === 0 || lines[i - 1].hash !== l.hash; // details only on the first line of each block
        const color = `var(--lane-${colors.get(l.hash)! + 1})`;
        return (
          <>
            <button
              onClick={() => onSelectCommit(l.hash)}
              title={`${l.summary}\n${l.author} · ${new Date(l.timestamp * 1000).toLocaleString("pt-BR")}\nClique para ver o commit`}
              style={{ width: GUTTER, boxShadow: `inset 3px 0 0 ${color}` }}
              className={cn("flex shrink-0 items-center gap-2 border-r pr-2 pl-3 text-left font-sans hover:bg-muted/60", first && i > 0 && "border-t border-t-border/60")}
            >
              {first && (
                <>
                  <AuthorAvatar name={l.author} email={l.email} />
                  <span className="w-14 shrink-0 font-mono text-[11px]" style={{ color }}>
                    {l.hash.slice(0, 7)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px]">{l.summary}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{relativeDate(l.timestamp)}</span>
                </>
              )}
            </button>
            <CodeLine n={l.line} text={l.text} />
          </>
        );
      }}
    />
  );
}

// ---------- File history ----------

function FileHistory({
  repo,
  path,
  current,
  onOpen,
  onSelectCommit,
}: {
  repo: string;
  path: string;
  current: string;
  onOpen: (hash: string) => void;
  onSelectCommit: (hash: string) => void;
}) {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  useEffect(() => {
    let stale = false;
    git.fileHistory(repo, path, 500).then(
      (c) => !stale && setCommits(c),
      (e) => toast.error(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [repo, path]);

  if (!commits) return <Loading />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-sidebar p-2">
      {commits.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhum commit com este arquivo.</p>}
      {commits.map((c, i) => (
        <div
          key={c.hash}
          className={cn(
            "group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/60",
            c.hash === current && "bg-accent shadow-[inset_2px_0_0_var(--primary)]",
          )}
        >
          {/* timeline dot */}
          <span className="relative flex w-3 justify-center self-stretch">
            {i < commits.length - 1 && <span className="absolute top-1/2 bottom-[-0.75rem] w-0.5 bg-primary/30" />}
            <span className="relative mt-auto mb-auto size-2.5 rounded-full bg-primary shadow-[0_0_6px_var(--glow)]" />
          </span>
          <AuthorAvatar name={c.author} email={c.email} className="size-6 text-[10px]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{c.subject}</p>
            <p className="text-xs text-muted-foreground">
              {c.author} · {relativeDate(c.timestamp)} · <span className="font-mono">{c.hash.slice(0, 7)}</span>
            </p>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onOpen(c.hash)}>
              Ver arquivo
            </button>
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onSelectCommit(c.hash)}>
              Ver commit
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
