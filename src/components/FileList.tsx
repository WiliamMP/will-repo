import type { ReactNode } from "react";
import type { FileChange } from "@/lib/git";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  A: "text-success",
  "?": "text-success",
  D: "text-destructive",
};

type Props = {
  files: FileChange[];
  selected?: string;
  onSelect?: (file: FileChange) => void;
  /** Extra buttons on the right of each row (stage, unstage...) */
  actions?: (file: FileChange) => ReactNode;
  showStats?: boolean;
};

export function FileList({ files, selected, onSelect, actions, showStats }: Props) {
  return (
    <ul className="p-1.5">
      {files.map((f) => (
        <li
          key={f.path}
          onClick={() => onSelect?.(f)}
          className={cn(
            "group flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted/60",
            selected === f.path && "bg-accent text-accent-foreground hover:bg-accent",
          )}
        >
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
          {actions && <span className="ml-auto flex shrink-0 opacity-0 group-hover:opacity-100">{actions(f)}</span>}
        </li>
      ))}
    </ul>
  );
}
