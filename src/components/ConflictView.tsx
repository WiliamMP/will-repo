import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { git, type Choice, type DiffLine, type RepoState } from "@/lib/git";
import { cn } from "@/lib/utils";

/** What "ours" and "theirs" mean depends on the operation: in a rebase they swap */
export function sideNames(kind: RepoState["kind"]) {
  return kind === "rebase"
    ? { ours: "Base (destino do rebase)", theirs: "Seu commit" }
    : { ours: "Atual (HEAD)", theirs: "Recebida" };
}

type Props = {
  repo: string;
  file: string;
  kind: RepoState["kind"];
  /** changes after every reload, so the view re-reads the file */
  version: unknown;
  run: (label: string, action: (path: string) => Promise<unknown>) => Promise<boolean>;
};

// Shows the conflicted file with each <<<<<<< ... >>>>>>> block and buttons to pick a side
export function ConflictView({ repo, file, kind, version, run }: Props) {
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  const names = sideNames(kind);

  useEffect(() => {
    let stale = false;
    git.conflictView(repo, file).then((l) => !stale && setLines(l), (e) => toast.error(String(e)));
    return () => {
      stale = true;
    };
  }, [repo, file, version]);

  const resolve = (block: number, choice: Choice) => run("conflito", (p) => git.resolveBlock(p, file, block, choice));

  let block = -1;
  const blocks = lines?.filter((l) => l.kind === "marker" && l.text.startsWith("<<<<<<<")).length ?? 0;

  return (
    <ScrollArea className="min-h-0 flex-1 bg-sidebar">
      {lines && (
        <div className="flex items-center gap-3 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-lane-2" /> {names.ours}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-primary" /> {names.theirs}
          </span>
          <span className="ml-auto">
            {blocks === 0 ? "Sem marcadores: pode marcar como resolvido" : `${blocks} conflito(s) no arquivo`}
          </span>
        </div>
      )}
      <pre className="min-w-max py-2 text-xs leading-5">
        {lines?.map((l, i) => {
          const opens = l.kind === "marker" && l.text.startsWith("<<<<<<<");
          if (opens) block++;
          const b = block;
          return (
            <div
              key={i}
              className={cn(
                "grid grid-cols-[40px_1fr] pr-3",
                l.kind === "ours" && "bg-lane-2/12 text-lane-2",
                l.kind === "theirs" && "bg-primary/12 text-primary",
                l.kind === "base" && "text-muted-foreground line-through",
                l.kind === "marker" && "bg-accent/40 text-muted-foreground",
                opens && "mt-1 border-t border-border/50 py-0.5",
              )}
            >
              <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.new}</span>
              {opens ? (
                <span className="flex items-center gap-1 font-sans">
                  <span className="sticky left-0 flex gap-1">
                    <ChoiceButton onClick={() => resolve(b, "ours")}>Usar {names.ours}</ChoiceButton>
                    <ChoiceButton onClick={() => resolve(b, "theirs")}>Usar {names.theirs}</ChoiceButton>
                    <ChoiceButton onClick={() => resolve(b, "both")}>Manter ambos</ChoiceButton>
                  </span>
                  <span className="ml-2 font-mono">{l.text}</span>
                </span>
              ) : (
                <span>{l.text}</span>
              )}
            </div>
          );
        })}
      </pre>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function ChoiceButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="outline" size="xs" className="h-5 bg-card" onClick={onClick}>
      {children}
    </Button>
  );
}
