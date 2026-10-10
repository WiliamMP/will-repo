import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  CircleDot,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  History,
  Loader2,
  LogIn,
  RotateCcw,
  Shuffle,
  Undo2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { git, relativeDate, type ReflogEntry, type RestoreAction, type UndoPlan } from "@/lib/git";
import { cn } from "@/lib/utils";

type Props = {
  repo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** runs a git action with the app's busy/toast/reload handling */
  run: (label: string, action: (path: string) => Promise<unknown>, success?: string) => Promise<boolean>;
  onUndo: () => void;
};

const ICONS: [string, LucideIcon, string][] = [
  ["commit", GitCommitHorizontal, "Commit"],
  ["checkout", LogIn, "Checkout"],
  ["merge", GitMerge, "Merge"],
  ["pull", ArrowDownToLine, "Pull"],
  ["reset", RotateCcw, "Reset"],
  ["rebase", Shuffle, "Rebase"],
  ["cherry-pick", GitCommitHorizontal, "Cherry-pick"],
  ["revert", Undo2, "Revert"],
  ["branch", GitBranch, "Branch"],
];
const kind = (action: string) => ICONS.find(([k]) => action.startsWith(k)) ?? ["", CircleDot, action];

// Every position HEAD had (git reflog): commits, checkouts, resets, rebases...
// Brings back "lost" commits with one click.
export function TimeMachine({ repo, open, onOpenChange, run, onUndo }: Props) {
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  const [undo, setUndo] = useState<UndoPlan | null>(null);
  const [naming, setNaming] = useState<string | null>(null); // hash getting a new branch
  const [name, setName] = useState("");

  const load = () => {
    setEntries(null);
    git.reflog(repo, 300).then(setEntries, () => setEntries([]));
    git.undoPreview(repo).then(setUndo, () => setUndo(null));
  };
  useEffect(() => {
    if (open) load();
  }, [open, repo]);

  const act = async (e: ReflogEntry, action: RestoreAction) => {
    const labels = { branch: `Branch ${name} criada`, checkout: `Checkout em ${e.hash.slice(0, 7)}`, reset: `Branch atual movida para ${e.hash.slice(0, 7)}` };
    if (await run("restore", (p) => git.restore(p, e.hash, action, action === "branch" ? name.trim() : undefined), labels[action])) {
      setNaming(null);
      setName("");
      load();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[min(720px,88vh)] w-[min(760px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <header className="flex items-center gap-3 border-b px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary shadow-[0_0_18px_-4px_var(--glow)]">
            <History className="size-5" />
          </span>
          <div className="flex-1">
            <DialogTitle className="text-base">Máquina do tempo</DialogTitle>
            <DialogDescription className="text-xs">Todos os lugares por onde o HEAD passou. Nada aqui se perde por 90 dias.</DialogDescription>
          </div>
          <button aria-label="Fechar" onClick={() => onOpenChange(false)} className="grid size-7 place-items-center rounded-full border text-muted-foreground hover:text-foreground hover:shadow-[0_0_14px_var(--glow)]">
            <X className="size-4" />
          </button>
        </header>

        {undo && (
          <div className="flex items-center gap-3 border-b bg-primary/5 px-5 py-3">
            <Undo2 className="size-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate text-sm" title={undo.description}>
              {undo.description}
            </p>
            <Button size="xs" onClick={onUndo}>
              Desfazer (Ctrl+Z)
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!entries ? (
            <Loader2 className="mx-auto mt-6 size-5 animate-spin text-primary" />
          ) : entries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhum movimento ainda.</p>
          ) : (
            entries.map((e, i) => {
              const [, Icon, label] = kind(e.action);
              return (
                <div key={e.selector} className={cn("group relative flex gap-3 rounded-lg px-3 py-2 hover:bg-muted/50", i === 0 && "bg-accent/60")}>
                  {/* timeline */}
                  <span className="relative flex w-7 shrink-0 justify-center">
                    {i < entries.length - 1 && <span className="absolute top-7 -bottom-2 w-0.5 bg-border" />}
                    <span className={cn("relative grid size-7 place-items-center rounded-full border bg-card", i === 0 && "border-primary text-primary shadow-[0_0_12px_var(--glow)]")}>
                      <Icon className="size-3.5" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{label}</span>
                      {i === 0 && <span className="rounded bg-primary/20 px-1.5 text-[10px] font-semibold text-primary uppercase">agora</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={e.message}>
                      {e.message || e.action}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                      {e.hash.slice(0, 7)} · {e.selector} · {relativeDate(e.timestamp)}
                    </p>
                    {naming === e.hash && (
                      <form
                        className="mt-2 flex gap-2"
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          if (name.trim()) act(e, "branch");
                        }}
                      >
                        <Input autoFocus className="h-7" placeholder="nome-da-branch" value={name} onChange={(ev) => setName(ev.target.value.replace(/\s/g, "-"))} />
                        <Button size="xs" type="submit" disabled={!name.trim()}>
                          Criar
                        </Button>
                        <Button size="xs" variant="ghost" type="button" onClick={() => setNaming(null)}>
                          Cancelar
                        </Button>
                      </form>
                    )}
                  </div>
                  {i > 0 && naming !== e.hash && (
                    <div className="flex shrink-0 items-start gap-1 opacity-0 group-hover:opacity-100">
                      <Button size="xs" variant="outline" title="Nova branch apontando para cá (o mais seguro)" onClick={() => setNaming(e.hash)}>
                        <GitBranchPlus /> Branch
                      </Button>
                      <Button size="xs" variant="ghost" title="Ver como estava (HEAD destacado)" onClick={() => act(e, "checkout")}>
                        <LogIn /> Checkout
                      </Button>
                      <Button size="xs" variant="ghost" title="Mover a branch atual para cá, mantendo alterações locais" onClick={() => act(e, "reset")}>
                        <RotateCcw /> Voltar para cá
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
