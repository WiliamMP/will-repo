import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Columns2, Rows2 } from "lucide-react";
import { updateSettings, useSettings } from "@/hooks/use-settings";
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

/** A diff line with its hunk number and its position inside the hunk (-1 = the @@ line) */
export type Row = { l: DiffLine; hunk: number; body: number };
/** Side-by-side row: old version on the left, new on the right, or a hunk header across */
export type SplitRow = { header: Row } | { left?: Row; right?: Row };

const LINE = 20; // px, leading-5
const HEADER = 28; // @@ rows are taller: they hold the stage/discard buttons

// Unified or side-by-side diff. Only the lines on screen exist in the DOM
// (virtual list, like History), so huge files scroll smoothly.
export function DiffView({ lines, hunkActions }: Props) {
  const { diffLayout } = useSettings();
  const [sel, setSel] = useState<Selection>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A new diff (file changed, or after staging) clears the selection
  useEffect(() => setSel(null), [lines]);

  // Body index = position of the line inside its hunk (after the @@ line).
  // Same numbering Rust uses in lines_patch.
  const rows = useMemo(() => {
    let hunk = -1;
    let body = 0;
    return (lines ?? []).map((l): Row => {
      if (l.kind === "hunk") {
        hunk++;
        body = 0;
        return { l, hunk, body: -1 };
      }
      return { l, hunk, body: body++ };
    });
  }, [lines]);

  const split = useMemo(() => toSplit(rows), [rows]);
  const isSplit = diffLayout === "split";
  const count = isSplit ? split.length : rows.length;
  const longest = useMemo(() => rows.reduce((m, r) => Math.max(m, r.l.text.length), 20), [rows]);
  // line number columns as wide as the biggest number (5 digits for a 10000+ line file)
  const num = useMemo(() => {
    const max = rows.reduce((m, r) => Math.max(m, r.l.old ?? 0, r.l.new ?? 0), 0);
    return `${Math.max(3, String(max).length) + 1.5}ch`;
  }, [rows]);

  const virtual = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ((isSplit ? "header" in split[i] : rows[i].l.kind === "hunk") ? HEADER : LINE),
    overscan: 30,
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

  if (lines === null) return <div className="min-h-0 flex-1 bg-sidebar" />;
  if (lines.length === 0)
    return <p className="min-h-0 flex-1 bg-sidebar p-4 text-xs text-muted-foreground">Sem alterações de conteúdo.</p>;

  const header = (r: Row) => (
    <div className="flex h-7 items-center gap-2 border-y border-border/50 bg-accent/40 pl-2 whitespace-nowrap text-primary/80">
      {hunkActions && (
        // sticky left keeps the buttons visible when scrolling a wide diff sideways
        <span className="sticky left-2 flex gap-1 font-sans">
          {hunkActions(r.hunk, sel?.hunk === r.hunk ? [...sel.lines].sort((a, b) => a - b) : [])}
        </span>
      )}
      <span>{r.l.text}</span>
    </div>
  );

  const cell = (r: Row | undefined, side: "old" | "new" | "both") => {
    if (!r) return <div className="h-full bg-muted/20" />; // filler opposite a lone add/del
    const { l } = r;
    const changed = l.kind === "add" || l.kind === "del";
    const clickable = !!hunkActions && changed;
    const selected = !!sel && sel.hunk === r.hunk && sel.lines.includes(r.body);
    const number = side === "old" ? l.old : side === "new" ? l.new : null;
    return (
      <div
        style={{ gridTemplateColumns: side === "both" ? `${num} ${num} 1fr` : `${num} 1fr` }}
        onClick={clickable ? (e) => pick(r.hunk, r.body, e.shiftKey) : undefined}
        className={cn(
          "grid",
          l.kind === "add" && "bg-diff-add text-success",
          l.kind === "del" && "bg-diff-del text-destructive",
          l.kind === "info" && "px-3 text-muted-foreground",
          clickable && "cursor-pointer hover:brightness-125",
          selected && "shadow-[inset_3px_0_0_var(--primary)] ring-1 ring-primary/40 ring-inset",
        )}
      >
        {side === "both" ? (
          <>
            <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.old ?? ""}</span>
            <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.new ?? ""}</span>
          </>
        ) : (
          <span className="pr-2 text-right text-muted-foreground/60 select-none">{number ?? ""}</span>
        )}
        <span className={cn("pr-3 whitespace-pre", clickable && "select-none")}>
          {l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "ctx" ? " " : ""}
          {l.text}
        </span>
      </div>
    );
  };

  // wide enough for the longest line, so the diff scrolls sideways instead of wrapping
  const minWidth = isSplit ? `calc(2 * (${num} + ${longest + 4}ch))` : `calc(2 * ${num} + ${longest + 4}ch)`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b px-2">
        {(
          [
            ["unified", Rows2, "Unificado"],
            ["split", Columns2, "Lado a lado"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            title={label}
            onClick={() => updateSettings({ diffLayout: value })}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground",
              diffLayout === value && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative font-mono text-xs leading-5" style={{ height: virtual.getTotalSize() + 16, minWidth }}>
          {virtual.getVirtualItems().map((item) => {
            const style = { transform: `translateY(${item.start + 8}px)`, height: item.size };
            const base = "absolute top-0 left-0 w-full";
            if (!isSplit) {
              const r = rows[item.index];
              return (
                <div key={item.key} style={style} className={base}>
                  {r.l.kind === "hunk" ? header(r) : cell(r, "both")}
                </div>
              );
            }
            const s = split[item.index];
            return (
              <div key={item.key} style={style} className={cn(base, !("header" in s) && "grid grid-cols-2")}>
                {"header" in s ? (
                  header(s.header)
                ) : (
                  <>
                    {cell(s.left, "old")}
                    {/* the middle border separates the two versions */}
                    <div className="border-l border-border/60">{cell(s.right, "new")}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Pairs each run of removed lines with the added lines that follow it */
export function toSplit(rows: Row[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: Row[] = [];
  let adds: Row[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.l.kind === "del") {
      if (adds.length) flush(); // "+ then -" starts a new pair
      dels.push(r);
    } else if (r.l.kind === "add") adds.push(r);
    else {
      flush();
      out.push(r.l.kind === "hunk" ? { header: r } : { left: r, right: r });
    }
  }
  flush();
  return out;
}
