import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Commit } from "@/lib/git";

type Props = {
  /** commit to tag; null = closed */
  commit: Commit | null;
  onClose: () => void;
  onCreate: (name: string, message: string) => Promise<boolean>;
};

// Opened from the commit's right-click menu, so it has no trigger button (open = commit !== null)
export function TagDialog({ commit, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await onCreate(name.trim(), message)) {
      onClose();
      setName("");
      setMessage("");
    }
  };

  return (
    <Dialog open={!!commit} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Nova tag</DialogTitle>
            <DialogDescription className="truncate">
              Em <span className="font-mono">{commit?.hash.slice(0, 7)}</span> {commit?.subject}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tag-name">Nome</Label>
            <Input
              id="tag-name"
              autoFocus
              placeholder="v1.0.0"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s/g, "-"))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tag-message">Mensagem (opcional: cria tag anotada)</Label>
            <Textarea
              id="tag-message"
              className="min-h-16 resize-none"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              Criar tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
