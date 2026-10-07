import type { Commit } from "@/lib/git";

const ROW = 28; // must match the row height (h-7) in History.tsx
const COL = 16; // horizontal space per lane
const PAD = 12;

const x = (lane: number) => PAD + lane * COL;
const y = (row: number) => row * ROW + ROW / 2;
const color = (lane: number) => `var(--lane-${(lane % 6) + 1})`;

export const graphWidth = (commits: Commit[]) =>
  PAD * 2 + Math.max(0, ...commits.map((c) => c.lane)) * COL;

// Draws all lines and dots for the commit list in one SVG,
// placed behind the rows (like painting on a TPaintBox under a grid).
// Lane rules come from assign_lanes in src-tauri/src/parse.rs:
// - first parent: the line stays in the child's lane and bends at the end
// - other parents (merges): the line bends right away into the parent's lane
export function Graph({ commits, selected }: { commits: Commit[]; selected: number }) {
  const index = new Map(commits.map((c, i) => [c.hash, i]));
  const height = commits.length * ROW;

  const edges = commits.flatMap((c, i) =>
    c.parents.map((hash, n) => {
      const p = index.get(hash);
      const [x1, y1] = [x(c.lane), y(i)];
      // Parent outside the loaded history: run the line off the bottom
      if (p === undefined) return { d: `M${x1},${y1} V${height}`, lane: c.lane, key: `${i}-${n}` };

      const parent = commits[p];
      const [x2, y2] = [x(parent.lane), y(p)];
      let d: string;
      if (x1 === x2) d = `M${x1},${y1} V${y2}`;
      else if (n === 0) d = `M${x1},${y1} V${y2 - ROW} C${x1},${y2 - ROW / 2} ${x2},${y2 - ROW / 2} ${x2},${y2}`;
      else d = `M${x1},${y1} C${x1},${y1 + ROW / 2} ${x2},${y1 + ROW / 2} ${x2},${y1 + ROW} V${y2}`;
      return { d, lane: n === 0 ? c.lane : parent.lane, key: `${i}-${n}` };
    }),
  );

  return (
    <svg width={graphWidth(commits)} height={height} className="block">
      {edges.map((e) => (
        <path key={e.key} d={e.d} fill="none" stroke={color(e.lane)} strokeWidth={2} />
      ))}
      {commits.map((c, i) => (
        <circle
          key={c.hash}
          cx={x(c.lane)}
          cy={y(i)}
          r={i === selected ? 5.5 : 4.5}
          fill={c.parents.length > 1 ? "var(--background)" : color(c.lane)}
          stroke={color(c.lane)}
          strokeWidth={2}
          style={i === selected ? { filter: `drop-shadow(0 0 4px ${color(c.lane)})` } : undefined}
        />
      ))}
    </svg>
  );
}
