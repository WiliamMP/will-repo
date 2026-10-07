import { ScrollArea } from "@/components/ui/scroll-area";
import { Graph, graphWidth } from "@/components/Graph";
import { RefBadge } from "@/components/RefBadge";
import { relativeDate, type Commit } from "@/lib/git";
import { cn } from "@/lib/utils";

type Props = { commits: Commit[]; selected: number; onSelect: (index: number) => void };

// ponytail: renders all rows (max 1000 from Rust), add virtualization if scrolling gets slow
export function History({ commits, selected, onSelect }: Props) {
  // Graph column grows with the number of lanes
  const cols = { gridTemplateColumns: `${Math.max(72, graphWidth(commits))}px 1fr 120px 110px` };

  return (
    <main className="flex h-full flex-col">
      <div style={cols} className="grid h-8 shrink-0 items-center gap-2 border-b pr-3 text-[11px] tracking-wider text-muted-foreground uppercase">
        <span className="pl-3">Grafo</span>
        <span>Descrição</span>
        <span>Autor</span>
        <span>Data</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {commits.length === 0 && <p className="p-4 text-muted-foreground">Nenhum commit ainda.</p>}
        <div className="relative">
          <div className="pointer-events-none absolute top-0 left-0 z-10">
            <Graph commits={commits} selected={selected} />
          </div>
          {commits.map((c, i) => (
            <div
              key={c.hash}
              style={cols}
              onClick={() => onSelect(i)}
              className={cn(
                "grid h-7 cursor-pointer items-center gap-2 pr-3 hover:bg-muted/60",
                i === selected && "bg-accent shadow-[inset_2px_0_0_var(--primary)] hover:bg-accent",
              )}
            >
              <span />
              <span className="flex min-w-0 items-center gap-1">
                {c.refs.map((r) => (
                  <RefBadge key={r.kind + r.name} refInfo={r} lane={c.lane} />
                ))}
                <span className="truncate" title={c.subject}>
                  {c.subject}
                </span>
              </span>
              <span className="truncate text-xs text-muted-foreground">{c.author}</span>
              <span className="truncate text-xs text-muted-foreground">{relativeDate(c.timestamp)}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </main>
  );
}
