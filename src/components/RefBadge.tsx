import { Archive, Cloud, GitBranch, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RefLabel } from "@/lib/git";
import { cn } from "@/lib/utils";

export function RefBadge({ refInfo, lane }: { refInfo: RefLabel; lane: number }) {
  const color =
    refInfo.kind === "tag"
      ? "var(--warning)"
      : refInfo.kind === "stash"
        ? "var(--muted-foreground)"
        : `var(--lane-${(lane % 6) + 1})`;
  return (
    <Badge
      variant="outline"
      style={{ "--c": color } as React.CSSProperties}
      className={cn(
        "h-[18px] shrink-0 gap-1 rounded-sm border-(--c) px-1.5 font-mono text-[11px] text-(--c)",
        refInfo.kind === "head" && "bg-(--c) text-white",
        (refInfo.kind === "branch" || refInfo.kind === "tag") && "bg-(--c)/15",
        (refInfo.kind === "remote" || refInfo.kind === "stash") && "border-dashed",
      )}
    >
      {refInfo.kind === "tag" ? <Tag /> : refInfo.kind === "remote" ? <Cloud /> : refInfo.kind === "stash" ? <Archive /> : <GitBranch />}
      {refInfo.name}
    </Badge>
  );
}
