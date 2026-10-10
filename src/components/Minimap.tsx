import { useRef, type RefObject } from "react";
import type { Commit } from "@/lib/git";

type Props = {
  commits: Commit[];
  /** the history's scroll box; the minimap works as its scrollbar */
  scrollRef: RefObject<HTMLDivElement | null>;
};

const markerColor = (c: Commit) => {
  const kinds = c.refs.map((r) => r.kind);
  if (kinds.includes("head")) return "var(--primary)";
  if (kinds.includes("tag")) return "var(--warning)";
  if (kinds.includes("stash")) return "var(--muted-foreground)";
  if (kinds.includes("branch")) return `var(--lane-${(c.lane % 6) + 1})`;
  return null; // remote-only refs would clutter the strip
};

// Strip on the right of the history: one tick per branch/tag/stash, the visible window
// as a glowing box, click or drag to jump (like VS Code's minimap scrollbar).
// It re-renders with the history on every scroll, so it reads the scroll box directly.
export function Minimap({ commits, scrollRef }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const box = scrollRef.current;
  if (!box || commits.length === 0 || box.scrollHeight <= box.clientHeight) return null;

  const total = box.scrollHeight;
  const view = { top: (box.scrollTop / total) * 100, height: (box.clientHeight / total) * 100 };
  // rows are evenly spaced; the list may have extra space below (the "load more" button)
  const rowsShare = (commits.length * 28) / total;

  const jump = (clientY: number) => {
    const strip = stripRef.current!.getBoundingClientRect();
    const frac = (clientY - strip.top) / strip.height;
    box.scrollTop = frac * total - box.clientHeight / 2;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    jump(e.clientY);
    const move = (ev: MouseEvent) => jump(ev.clientY);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      ref={stripRef}
      onMouseDown={onMouseDown}
      title="Minimapa: clique ou arraste para navegar"
      className="absolute top-0 right-0 bottom-0 z-20 w-3.5 cursor-pointer border-l bg-sidebar/80"
    >
      {commits.map((c, i) => {
        const color = markerColor(c);
        return (
          color && (
            <span
              key={c.hash}
              className="absolute right-0.5 left-0.5 h-0.5 rounded-full"
              style={{ top: `${(i / commits.length) * rowsShare * 100}%`, background: color, boxShadow: `0 0 4px ${color}` }}
            />
          )
        );
      })}
      <span
        className="pointer-events-none absolute right-0 left-0 rounded-sm border border-primary/60 bg-primary/15 shadow-[0_0_10px_var(--glow)]"
        style={{ top: `${view.top}%`, height: `${Math.max(view.height, 2)}%` }}
      />
    </div>
  );
}
