import { useEffect, useState, type ReactNode } from "react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { DiffLine } from "@/lib/git";
import { cn } from "@/lib/utils";

type Props = {
  lines: DiffLine[] | null;
  /**
   * Buttons shown on each hunk header (@@ line). Gets the hunk number (0-based)
   * and the selected body lines of that hunk. When given, +/- lines become clickable.
   */
  hunkActions?: (hunk: number, selected: number[]) => ReactNode;
};

type Selection = { hunk: number; lines: number[]; anchor: number } | null;

// ponytail: renders every line, add virtualization if huge diffs get slow
export function DiffView({ lines, hunkActions }: Props) {
  const [sel, setSel] = useState<Selection>(null);

  // A new diff (file changed, or after staging) clears the selection
  useEffect(() => setSel(null), [lines]);

  // Body index = position of the line inside its hunk (after the @@ line).
  // Same numbering Rust uses in lines_patch.
  let hunk = -1;
  let body = 0;
  const rows = (lines ?? []).map((l) => {
    if (l.kind === "hunk") {
      hunk++;
      body = 0;
      return { l, hunk, body: -1 };
    }
    return { l, hunk, body: body++ };
  });

  // Click toggles one line; Shift+click selects every +/- line between the last click and this one
  const pick = (h: number, b: number, shift: boolean) => {
    setSel((cur) => {
      if (!cur || cur.hunk !== h) return { hunk: h, lines: [b], anchor: b };
      if (shift) {
        const [from, to] = [Math.min(cur.anchor, b), Math.max(cur.anchor, b)];
        const range = rows
          .filter((r) => r.hunk === h && r.body >= from && r.body <= to && (r.l.kind === "add" || r.l.kind === "del"))
          .map((r) => r.body);
        return { ...cur, lines: [...new Set([...cur.lines, ...range])] };
      }
      const lines = cur.lines.includes(b) ? cur.lines.filter((x) => x !== b) : [...cur.lines, b];
      return lines.length ? { hunk: h, lines, anchor: b } : null;
    });
  };

  return (
    <ScrollArea className="min-h-0 flex-1 bg-sidebar">
      {lines === null ? null : lines.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">Sem alterações de conteúdo.</p>
      ) : (
        <pre className="min-w-max py-2 text-xs leading-5">
          {rows.map(({ l, hunk: h, body: b }, i) => {
            const changed = l.kind === "add" || l.kind === "del";
            const clickable = !!hunkActions && changed;
            const selected = !!sel && sel.hunk === h && sel.lines.includes(b);
            return (
              <div
                key={i}
                onClick={clickable ? (e) => pick(h, b, e.shiftKey) : undefined}
                className={cn(
                  "grid grid-cols-[40px_40px_1fr] pr-3",
                  l.kind === "add" && "bg-diff-add text-success",
                  l.kind === "del" && "bg-diff-del text-destructive",
                  l.kind === "hunk" && "mt-1 items-center border-y border-border/50 bg-accent/40 py-0.5 text-primary/80 first:mt-0",
                  l.kind === "info" && "px-3 text-muted-foreground",
                  clickable && "cursor-pointer hover:brightness-125",
                  selected && "shadow-[inset_3px_0_0_var(--primary)] ring-1 ring-primary/40 ring-inset",
                )}
              >
                <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.old ?? ""}</span>
                <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.new ?? ""}</span>
                {l.kind === "hunk" && hunkActions ? (
                  // sticky left keeps the buttons visible when scrolling a wide diff sideways
                  <span className="flex items-center gap-2">
                    <span className="sticky left-0 flex gap-1 font-sans">
                      {hunkActions(h, sel?.hunk === h ? [...sel.lines].sort((a, b) => a - b) : [])}
                    </span>
                    <span>{l.text}</span>
                  </span>
                ) : (
                  <span className={cn(clickable && "select-none")}>
                    {l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "ctx" ? " " : ""}
                    {l.text}
                  </span>
                )}
              </div>
            );
          })}
        </pre>
      )}
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
