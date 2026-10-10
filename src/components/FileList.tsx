import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { quick } from "@/components/motion";
import type { FileChange } from "@/lib/git";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  A: "text-success",
  "?": "text-success",
  D: "text-destructive",
  U: "text-destructive",
};

type Props = {
  files: FileChange[];
  selected?: string;
  onSelect?: (file: FileChange) => void;
  /** Extra buttons on the right of each row (stage, unstage...) */
  actions?: (file: FileChange) => ReactNode;
  showStats?: boolean;
  /**
   * Animate rows. Returning an id makes a file glide to the same id in another list
   * (staged <-> unstaged); undefined when the same path is in both lists at once.
   */
  layoutId?: (file: FileChange) => string | undefined;
};

export function FileList({ files, selected, onSelect, actions, showStats, layoutId }: Props) {
  const animated = !!layoutId;
  const rows = files.map((f) => {
    const className = cn(
      "group flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted/60",
      selected === f.path && "bg-accent text-accent-foreground hover:bg-accent",
    );
    const content = (
      <>
        <span className={cn("w-4 shrink-0 text-center font-mono font-bold text-warning", STATUS_COLOR[f.status])}>
          {f.status === "?" ? "U" : f.status}
        </span>
        <span className="truncate" title={f.path}>
          {f.path}
        </span>
        {showStats && (
          <span className="ml-auto shrink-0 font-mono text-[11px]">
            <span className="text-success">+{f.add}</span> <span className="text-destructive">-{f.del}</span>
          </span>
        )}
        {actions && <span className={cn("flex shrink-0 opacity-0 group-hover:opacity-100", !showStats && "ml-auto")}>{actions(f)}</span>}
      </>
    );
    return animated ? (
      <motion.li
        key={f.path}
        layout="position"
        layoutId={layoutId(f)}
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 6, transition: quick }}
        onClick={() => onSelect?.(f)}
        className={className}
      >
        {content}
      </motion.li>
    ) : (
      <li key={f.path} onClick={() => onSelect?.(f)} className={className}>
        {content}
      </li>
    );
  });

  return (
    <ul className="p-1.5">
      {/* initial={false}: no entrance on first paint, only when files come and go */}
      {animated ? <AnimatePresence initial={false} mode="popLayout">{rows}</AnimatePresence> : rows}
    </ul>
  );
}
