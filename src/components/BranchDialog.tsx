import { useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

type Props = {
  /** `from` = start point; null = current HEAD */
  onCreate: (name: string, checkout: boolean, from: string | null) => Promise<boolean>;
  disabled?: boolean;
  /** local branches, for "start from" */
  branches: string[];
  /** branch used by templates with no base set (main/master) */
  defaultBase: string;
  /** optional: opened from outside (command palette) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const HEAD = "__head__"; // Select can't use null as a value

// Like a modal TForm with ShowModal: opens, collects the name, closes on success.
// Branch templates (feature/, fix/...) fill the prefix and the start point.
export function BranchDialog({ onCreate, disabled, branches, defaultBase, ...controlled }: Props) {
  const { branchTemplates } = useSettings();
  const [inner, setInner] = useState(false);
  const open = controlled.open ?? inner;
  const setOpen = controlled.onOpenChange ?? setInner;
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [from, setFrom] = useState(HEAD);

  useEffect(() => {
    if (open) setFrom(HEAD);
  }, [open]);

  const template = branchTemplates.find((t) => name.startsWith(t.prefix));
  const pickTemplate = (prefix: string) => {
    const t = branchTemplates.find((x) => x.prefix === prefix)!;
    // swap the prefix, keep what was typed after it
    setName(prefix + (template ? name.slice(template.prefix.length) : name));
    setFrom(t.base || defaultBase);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await onCreate(name.trim(), checkout, from === HEAD ? null : from)) {
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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Nova branch</DialogTitle>
            <DialogDescription>Escolha um modelo ou digite o nome.</DialogDescription>
          </DialogHeader>
          {branchTemplates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {branchTemplates.map((t) => (
                <button
                  key={t.prefix}
                  type="button"
                  onClick={() => pickTemplate(t.prefix)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground",
                    template?.prefix === t.prefix && "border-primary bg-primary/15 text-primary shadow-[0_0_12px_-4px_var(--glow)]",
                  )}
                >
                  {t.prefix}
                </button>
              ))}
            </div>
          )}
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
          <div className="flex flex-col gap-2">
            <Label>A partir de</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={HEAD}>Commit atual (HEAD)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
