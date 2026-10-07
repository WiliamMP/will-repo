import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Cloud, GitBranch, Search, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Refs } from "@/lib/git";
import { cn } from "@/lib/utils";

type Props = {
  refs: Refs;
  /** Double click on a branch: switch to it */
  onCheckout: (name: string, remote: boolean) => void;
};

export function Sidebar({ refs, onCheckout }: Props) {
  const [filter, setFilter] = useState("");
  const match = (names: string[]) => names.filter((n) => n.toLowerCase().includes(filter.toLowerCase()));

  return (
    <aside className="flex h-full flex-col gap-3 bg-sidebar p-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filtrar branches..."
          className="h-8 pl-8"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4">
          <Section title="Branches" icon={GitBranch} items={match(refs.branches)} active={refs.head}
            onOpen={(n) => onCheckout(n, false)} />
          <Section title="Remotes" icon={Cloud} items={match(refs.remotes)} onOpen={(n) => onCheckout(n, true)} />
          <Section title="Tags" icon={Tag} items={match(refs.tags)} />
        </div>
      </ScrollArea>
    </aside>
  );
}

type SectionProps = {
  title: string;
  icon: LucideIcon;
  items: string[];
  active?: string | null;
  onOpen?: (name: string) => void;
};

function Section({ title, icon: Icon, items, active, onOpen }: SectionProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{title}</h3>
      {items.map((name) => (
        <div
          key={name}
          onDoubleClick={() => name !== active && onOpen?.(name)}
          title={onOpen && name !== active ? "Duplo clique para fazer checkout" : undefined}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground",
            name === active &&
              "bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{name}</span>
        </div>
      ))}
    </div>
  );
}
