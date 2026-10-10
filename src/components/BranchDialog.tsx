import { useState } from "react";
import { GitBranch } from "lucide-react";
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
  onCreate: (name: string, checkout: boolean) => Promise<boolean>;
  disabled?: boolean;
  /** optional: opened from outside (command palette) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

// Like a modal TForm with ShowModal: opens, collects the name, closes on success
export function BranchDialog({ onCreate, disabled, ...controlled }: Props) {
  const [inner, setInner] = useState(false);
  const open = controlled.open ?? inner;
  const setOpen = controlled.onOpenChange ?? setInner;
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await onCreate(name.trim(), checkout)) {
      setOpen(false);
      setName("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <GitBranch /> Branch
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Nova branch</DialogTitle>
            <DialogDescription>Criada a partir do commit atual (HEAD).</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="branch-name">Nome</Label>
            <Input
              id="branch-name"
              autoFocus
              placeholder="feature/minha-branch"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s/g, "-"))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="branch-checkout" checked={checkout} onCheckedChange={(v) => setCheckout(v === true)} />
            <Label htmlFor="branch-checkout">Fazer checkout após criar</Label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              Criar branch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
