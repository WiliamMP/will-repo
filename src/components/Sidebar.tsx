import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Archive, ArrowUpFromLine, Cloud, Eye, EyeOff, Focus, GitBranch, GitMerge, GitPullRequestArrow, LogIn, Search, Tag, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Refs, Stash } from "@/lib/git";
import { cn } from "@/lib/utils";

export type BranchActions = {
  checkout: (name: string, remote: boolean) => void;
  merge: (name: string) => void;
  rebase: (name: string) => void;
  remove: (name: string) => void;
  pushTag: (name: string) => void;
  deleteTag: (name: string) => void;
  /** focus mode of the graph */
  solo: (name: string) => void;
  toggleHidden: (name: string) => void;
};

type Props = {
  refs: Refs;
  stashes: Stash[];
  selectedStash: string | null;
  onSelectStash: (name: string) => void;
  actions: BranchActions;
  /** branches hidden from the graph (focus mode) */
  hidden: string[];
};

export function Sidebar({ refs, stashes, selectedStash, onSelectStash, actions, hidden }: Props) {
  const [filter, setFilter] = useState("");
  const match = (names: string[]) => names.filter((n) => n.toLowerCase().includes(filter.toLowerCase()));
  const head = refs.head ?? "HEAD";

  // Right-click menu of a branch (like a TPopupMenu attached to each item)
  // Focus mode entries, also for the current branch
  const focusItems = (name: string) => (
    <>
      <ContextMenuItem onSelect={() => actions.solo(name)}>
        <Focus /> Isolar no grafo
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.toggleHidden(name)}>
        {hidden.includes(name) ? (
          <>
            <Eye /> Mostrar no grafo
          </>
        ) : (
          <>
            <EyeOff /> Esconder do grafo
          </>
        )}
      </ContextMenuItem>
    </>
  );

  const branchMenu = (name: string, remote: boolean) =>
    name === refs.head ? (
      focusItems(name)
    ) : (
      <>
        {focusItems(name)}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.checkout(name, remote)}>
          <LogIn /> Checkout {remote && "(cria branch local)"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.merge(name)}>
          <GitMerge /> Mesclar {name} em {head}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.rebase(name)}>
          <GitPullRequestArrow /> Rebase de {head} sobre {name}
        </ContextMenuItem>
        {!remote && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => actions.remove(name)}>
              <Trash2 /> Excluir {name}
            </ContextMenuItem>
          </>
        )}
      </>
    );

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
          <Section
            title="Branches"
            icon={GitBranch}
            items={match(refs.branches)}
            active={refs.head}
            onOpen={(n) => actions.checkout(n, false)}
            menu={(n) => branchMenu(n, false)}
            hidden={hidden}
          />
          <Section
            title="Remotes"
            icon={Cloud}
            items={match(refs.remotes)}
            onOpen={(n) => actions.checkout(n, true)}
            menu={(n) => branchMenu(n, true)}
            hidden={hidden}
          />
          <Section
            title="Tags"
            icon={Tag}
            items={match(refs.tags)}
            menu={(n) => (
              <>
                <ContextMenuItem onSelect={() => actions.pushTag(n)}>
                  <ArrowUpFromLine /> Enviar {n} para origin
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => actions.deleteTag(n)}>
                  <Trash2 /> Excluir {n}
                </ContextMenuItem>
              </>
            )}
          />
          {stashes.length > 0 && (
            <div>
              <SectionTitle>Stashes</SectionTitle>
              {stashes.map((s) => (
                <div
                  key={s.name}
                  onClick={() => onSelectStash(s.name)}
                  title={s.message}
                  className={cn(itemClass, s.name === selectedStash && activeClass)}
                >
                  <Archive className="size-3.5 shrink-0" />
                  <span className="truncate">{s.message.replace(/^(WIP on|On) [^:]+: /, "")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground";
const activeClass =
  "bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{children}</h3>;
}

type SectionProps = {
  title: string;
  icon: LucideIcon;
  items: string[];
  active?: string | null;
  onOpen?: (name: string) => void;
  menu?: (name: string) => ReactNode;
};

function Section({ title, icon: Icon, items, active, onOpen, menu, hidden }: SectionProps & { hidden?: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {items.map((name) => {
        const row = (
          <div
            onDoubleClick={() => name !== active && onOpen?.(name)}
            title={onOpen && name !== active ? "Duplo clique: checkout · Botão direito: mais ações" : undefined}
            className={cn(itemClass, name === active && activeClass)}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{name}</span>
            {hidden?.includes(name) && <EyeOff className="ml-auto size-3 shrink-0 opacity-60" aria-label="Escondida do grafo" />}
          </div>
        );
        const items = menu?.(name);
        return items ? (
          <ContextMenu key={name}>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>{items}</ContextMenuContent>
          </ContextMenu>
        ) : (
          <div key={name}>{row}</div>
        );
      })}
    </div>
  );
}
