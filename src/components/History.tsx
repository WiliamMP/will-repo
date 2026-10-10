import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ChevronsDown, CirclePlus, FolderTree, Copy, Focus as FocusIcon, Loader2, Search, Tag, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { Graph, graphWidth } from "@/components/Graph";
import { Minimap } from "@/components/Minimap";
import { useSettings } from "@/hooks/use-settings";
import { RefBadge } from "@/components/RefBadge";
import { git, relativeDate, type Commit, type Focus } from "@/lib/git";
import { branchDropProps, dragBranch } from "@/lib/dnd";
import { cn } from "@/lib/utils";

const ROW = 28; // h-7, must match Graph.tsx

export type CommitActions = {
  cherryPick: (commit: Commit) => void;
  revert: (commit: Commit) => void;
  tag: (commit: Commit) => void;
  browse: (commit: Commit) => void;
};

type Props = {
  repo: string;
  commits: Commit[];
  selected: string | null;
  onSelect: (commit: Commit) => void;
  hasMore: boolean;
  onLoadMore: () => Promise<unknown>;
  actions: CommitActions;
  focus: Focus;
  onClearFocus: () => void;
  /** a branch was dropped onto another (drag and drop in the graph) */
  onBranchDrop: (source: string, target: string, x: number, y: number) => void;
};

export function History({ repo, commits, selected, onSelect, hasMore, onLoadMore, actions, focus, onClearFocus, onBranchDrop }: Props) {
  const [dropRow, setDropRow] = useState<string | null>(null);
  const { showAvatars } = useSettings();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Commit[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search in git (all history, not only loaded commits), 300 ms after the last key
  useEffect(() => {
    if (!query.trim()) return setResults(null);
    let stale = false;
    const t = setTimeout(() => {
      git.search(repo, query).then((r) => !stale && setResults(r), (e) => toast.error(String(e)));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [repo, query]);

  const searching = results !== null;
  const rows = results ?? commits;
  // Graph column grows with the number of lanes; no graph for search results
  const cols = { gridTemplateColumns: `${searching ? 12 : Math.max(72, graphWidth(commits))}px 1fr 120px 110px` };

  // Virtual list: only the rows on screen exist in the DOM (like a TListView in virtual mode / OwnerData)
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 15,
  });
  const items = virtual.getVirtualItems();
  const selectedIndex = rows.findIndex((c) => c.hash === selected);

  const loadMore = async () => {
    setLoadingMore(true);
    await onLoadMore();
    setLoadingMore(false);
  };

  return (
    <main className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="history-search"
            placeholder="Buscar por mensagem, autor ou hash..."
            className="h-7 pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
        </div>
        {(focus.solo || focus.hidden.length > 0) && !searching && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 py-0.5 pr-0.5 pl-2 text-xs text-primary shadow-[0_0_12px_-4px_var(--glow)]">
            <FocusIcon className="size-3.5" />
            {focus.solo ? `Só ${focus.solo}` : `${focus.hidden.length} escondida(s)`}
            <Button variant="ghost" size="icon-xs" className="size-5 text-primary" aria-label="Mostrar tudo" title="Mostrar todas as branches" onClick={onClearFocus}>
              <X />
            </Button>
          </span>
        )}
        {searching && (
          <>
            <span className="shrink-0 text-xs text-muted-foreground">{results.length} resultado(s)</span>
            <Button variant="ghost" size="icon-xs" aria-label="Limpar busca" onClick={() => setQuery("")}>
              <X />
            </Button>
          </>
        )}
      </div>
      <div style={cols} className="grid h-8 shrink-0 items-center gap-2 border-b pr-3 text-[11px] tracking-wider text-muted-foreground uppercase">
        <span className="pl-3">{searching ? "" : "Grafo"}</span>
        <span>Descrição</span>
        <span>Autor</span>
        <span>Data</span>
      </div>

      <div className="relative min-h-0 flex-1">
      {!searching && <Minimap commits={commits} scrollRef={scrollRef} />}
      {/* the minimap is the scrollbar here, so the native one is hidden */}
      <div ref={scrollRef} className={cn("h-full overflow-auto", !searching && "[scrollbar-width:none]")}>
        {rows.length === 0 && (
          <p className="p-4 text-muted-foreground">{searching ? "Nada encontrado." : "Nenhum commit ainda."}</p>
        )}
        <div className="relative" style={{ height: virtual.getTotalSize() }}>
          {!searching && items.length > 0 && (
            <div className="pointer-events-none absolute top-0 left-0 z-10">
              <Graph
                commits={commits}
                selected={selectedIndex}
                from={items[0].index}
                to={items[items.length - 1].index}
              />
            </div>
          )}
          {items.map((item) => {
            const c = rows[item.index];
            return (
              <ContextMenu key={c.hash}>
                <ContextMenuTrigger asChild>
                  <div
                    {...(() => {
                      // a row with a local branch accepts branches dropped on it
                      const target = c.refs.find((r) => r.kind === "head" || r.kind === "branch")?.name;
                      return target ? branchDropProps(target, onBranchDrop, (over) => setDropRow(over ? c.hash : null)) : {};
                    })()}
                    style={{ ...cols, transform: `translateY(${item.start}px)` }}
                    onClick={() => onSelect(c)}
                    className={cn(
                      "absolute top-0 left-0 grid h-7 w-full cursor-pointer items-center gap-2 pr-5 hover:bg-muted/60",
                    c.stash && "italic text-muted-foreground",
                    dropRow === c.hash && "bg-primary/20 ring-1 ring-primary ring-inset",
                      c.hash === selected && "bg-accent shadow-[inset_2px_0_0_var(--primary)] hover:bg-accent",
                    )}
                  >
                    <span />
                    <span className="flex min-w-0 items-center gap-1">
                      {c.refs.map((r) => (
                        <RefBadge
                        key={r.kind + r.name}
                        refInfo={r}
                        lane={c.lane}
                        // local and remote branches can be dragged onto another branch
                        draggable={r.kind === "head" || r.kind === "branch" || r.kind === "remote"}
                        onDragStart={(e) => dragBranch(e, r.name)}
                        className={r.kind !== "tag" && r.kind !== "stash" ? "cursor-grab active:cursor-grabbing" : undefined}
                      />
                      ))}
                      <span className="truncate" title={c.subject}>
                        {c.subject}
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {showAvatars && <AuthorAvatar name={c.author} email={c.email} />}
                      <span className="truncate">{c.author}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{relativeDate(c.timestamp)}</span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {c.stash ? (
                    <ContextMenuItem onSelect={() => onSelect(c)}>
                      <Archive /> Ver {c.stash}
                    </ContextMenuItem>
                  ) : (
                  <>
                  <ContextMenuItem onSelect={() => actions.cherryPick(c)}>
                    <CirclePlus /> Cherry-pick neste HEAD
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.revert(c)}>
                    <Undo2 /> Reverter commit
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => actions.tag(c)}>
                    <Tag /> Criar tag aqui
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.browse(c)}>
                    <FolderTree /> Navegar pelos arquivos
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => navigator.clipboard.writeText(c.hash).then(() => toast.success("Hash copiado"))}
                  >
                    <Copy /> Copiar hash
                  </ContextMenuItem>
                  </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        {!searching && hasMore && (
          <div className="flex justify-center p-3">
            <Button variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? <Loader2 className="animate-spin" /> : <ChevronsDown />} Carregar mais commits
            </Button>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
