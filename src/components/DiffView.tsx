import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { DiffLine } from "@/lib/git";
import { cn } from "@/lib/utils";

// ponytail: renders every line, add virtualization if huge diffs get slow
export function DiffView({ lines }: { lines: DiffLine[] | null }) {
  return (
    <ScrollArea className="min-h-0 flex-1 bg-sidebar">
      {lines === null ? null : lines.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">Sem alterações de conteúdo.</p>
      ) : (
        <pre className="min-w-max py-2 text-xs leading-5">
          {lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                "grid grid-cols-[40px_40px_1fr] pr-3",
                l.kind === "add" && "bg-diff-add text-success",
                l.kind === "del" && "bg-diff-del text-destructive",
                l.kind === "hunk" && "py-1 text-primary/80",
                l.kind === "info" && "px-3 text-muted-foreground",
              )}
            >
              <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.old ?? ""}</span>
              <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.new ?? ""}</span>
              <span>
                {l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "ctx" ? " " : ""}
                {l.text}
              </span>
            </div>
          ))}
        </pre>
      )}
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
