import { useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { git, relativeDate, type Discard } from "@/lib/git";

type Props = { repo: string; onRestore: (hash: string) => Promise<boolean> };

// Every discard saves a backup first; this lists them so any one can be brought back
export function DiscardsDialog({ repo, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Discard[] | null>(null);

  const load = (show: boolean) => {
    setOpen(show);
    if (!show) return;
    setItems(null);
    git.discardList(repo).then(setItems, (e) => toast.error(String(e)));
  };

  const restore = async (hash: string) => {
    if (await onRestore(hash)) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={load}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Descartes recentes" title="Descartes recentes">
          <History />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Descartes recentes</DialogTitle>
          <DialogDescription>Cópias guardadas antes de cada descarte, mantidas por pelo menos 30 dias.</DialogDescription>
        </DialogHeader>
        {!items ? (
          <Loader2 className="mx-auto size-5 animate-spin text-primary" />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">Nenhum descarte ainda.</p>
        ) : (
          <ScrollArea className="max-h-80">
            {items.map((d) => (
              <div key={d.hash} className="flex items-center gap-2 border-b py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs" title={d.files.join("\n")}>
                    {d.files.join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">{relativeDate(d.timestamp)}</p>
                </div>
                <Button size="xs" variant="outline" onClick={() => restore(d.hash)}>
                  <RotateCcw /> Restaurar
                </Button>
              </div>
            ))}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
