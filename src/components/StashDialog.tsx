import { useState } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  onStash: (message: string, untracked: boolean) => Promise<boolean>;
  disabled?: boolean;
  /** optional: opened from outside (command palette) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function StashDialog({ onStash, disabled, ...controlled }: Props) {
  const [inner, setInner] = useState(false);
  const open = controlled.open ?? inner;
  const setOpen = controlled.onOpenChange ?? setInner;
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await onStash(message, untracked)) {
      setOpen(false);
      setMessage("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Archive /> Stash
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Guardar alterações (stash)</DialogTitle>
            <DialogDescription>Salva as alterações e limpa a área de trabalho. Dá pra aplicar de volta depois.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stash-message">Mensagem (opcional)</Label>
            <Input
              id="stash-message"
              autoFocus
              placeholder="wip: tela de login"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="stash-untracked" checked={untracked} onCheckedChange={(v) => setUntracked(v === true)} />
            <Label htmlFor="stash-untracked">Incluir arquivos novos (não rastreados)</Label>
          </div>
          <DialogFooter>
            <Button type="submit">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
