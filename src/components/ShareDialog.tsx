import { useEffect, useState } from "react";
import { Loader2, Share2, ShieldAlert } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { git } from "@/lib/git";

// Share uncommitted changes as a secret GitHub Gist (one .patch file), like GitKraken's Cloud Patches.
// Whoever gets the link can see it and apply it with `git apply`.
export function ShareDialog({ repo, name }: { repo: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPatch(null);
    setError(null);
    setDescription(`Alterações em ${name}`);
    git.workingPatch(repo).then(setPatch, (e) => setError(String(e)));
  }, [open, repo]);

  const files = patch ? patch.match(/^diff --git /gm)?.length ?? 0 : 0;
  const added = patch?.match(/^\+(?!\+\+)/gm)?.length ?? 0;
  const removed = patch?.match(/^-(?!--)/gm)?.length ?? 0;

  const share = async () => {
    if (!patch) return;
    setBusy(true);
    try {
      const url = await git.createGist(description.trim() || `Alterações em ${name}`, `${name}.patch`, patch);
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success("Gist criado e link copiado", { action: { label: "Abrir", onClick: () => openUrl(url) }, duration: 10000 });
      setOpen(false);
    } catch (e) {
      const msg = String(e);
      toast.error(msg.startsWith("not_logged") ? "Entre no GitHub (Configurações > Conta) para compartilhar" : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Compartilhar alterações" title="Compartilhar as alterações como Gist secreto">
          <Share2 />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-4 text-primary" /> Compartilhar alterações
          </DialogTitle>
          <DialogDescription>Envia tudo o que ainda não foi commitado como um Gist secreto no seu GitHub.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : !patch ? (
          <Loader2 className="mx-auto size-5 animate-spin text-primary" />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm">
              {files} arquivo(s) · <span className="text-success">+{added}</span> <span className="text-destructive">-{removed}</span>
            </p>
            <pre className="max-h-40 overflow-auto rounded-lg border bg-sidebar p-2 font-mono text-[11px] leading-4 text-muted-foreground">
              {patch.split("\n").slice(0, 40).join("\n")}
              {patch.split("\n").length > 40 && "\n..."}
            </pre>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição" />
            <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <ShieldAlert className="size-4 shrink-0 text-warning" />
              Secreto não é privado: qualquer pessoa com o link consegue ver. Confira se não há senhas, tokens ou dados sensíveis.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button disabled={!patch || busy} onClick={share}>
            {busy ? <Loader2 className="animate-spin" /> : <Share2 />} Criar Gist e copiar link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
