import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { allCommands, matches, type Command } from "@/lib/commands";
import { cn } from "@/lib/utils";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

// Ctrl+K: type a few letters of any action and press Enter
export function CommandPalette({ open, onOpenChange }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  // read the registry on every render: it always has the commands of what is on screen now
  // a few dozen items: filtering on every render is cheap and never shows a stale list
  const results = allCommands().filter((c) => matches(c, query));
  const byGroup = new Map<string, Command[]>();
  for (const c of results) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  const groups = [...byGroup];

  useEffect(() => setIndex(0), [query]);
  // keep the highlighted item visible while moving with the arrows
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    // let the palette close first, so dialogs opened by the command get the focus
    setTimeout(c.run, 0);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, results.length - 1));
    else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter") run(results[index]);
    else return;
    e.preventDefault();
  };

  let n = -1; // running index across groups
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[16%] max-w-none translate-y-0 gap-0 overflow-hidden p-0 shadow-[0_0_60px_-12px_var(--glow)] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Paleta de comandos</DialogTitle>
        <DialogDescription className="sr-only">Busque e execute qualquer ação</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-primary" />
          <input
            autoFocus
            placeholder="O que você quer fazer?"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum comando.</p>}
          {groups.map(([group, items]) => (
            <div key={group} className="mb-1">
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{group}</p>
              {items.map((c) => {
                const i = ++n;
                const active = i === index;
                return (
                  <button
                    key={c.id}
                    data-index={i}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => run(c)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
                      active && "bg-accent text-accent-foreground shadow-[inset_2px_0_0_var(--primary)]",
                    )}
                  >
                    <c.icon className={cn("size-4 shrink-0 text-muted-foreground", active && "text-primary")} />
                    <span className="flex-1 truncate">{c.title}</span>
                    {c.shortcut && (
                      <span className="flex gap-1">
                        {c.shortcut.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    )}
                    {active && !c.shortcut && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
