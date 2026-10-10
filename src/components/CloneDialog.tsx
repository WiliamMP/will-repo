import { useEffect, useMemo, useState } from "react";
import { FolderOpen, GitFork, Globe, Loader2, Lock, Search } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Github } from "@/components/Dashboard";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { git, relativeDate, type GithubRepo } from "@/lib/git";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** folder suggested when no clone folder was used yet */
  suggestedParent: string;
  onCloned: (path: string) => void;
};

/** "https://github.com/a/b.git" or "git@github.com:a/b.git" -> "b" */
const repoName = (url: string) => url.trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() ?? "";

// Clone from your GitHub repositories or from any URL
export function CloneDialog({ open, onOpenChange, suggestedParent, onCloned }: Props) {
  const { cloneDir } = useSettings();
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setName("");
    setFilter("");
    setParent(cloneDir || suggestedParent);
    if (repos) return;
    git.githubRepos().then(setRepos, (e) => {
      const msg = String(e);
      setRepoError(msg.startsWith("not_logged") ? "Entre no GitHub (Configurações > Conta) para ver seus repositórios." : msg.startsWith("offline") ? "Sem internet." : msg);
    });
  }, [open]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (repos ?? []).filter((r) => !q || r.nameWithOwner.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q));
  }, [repos, filter]);

  const choose = (u: string) => {
    setUrl(u);
    setName(repoName(u));
  };

  const pick = async () => {
    const dir = await openDialog({ directory: true, title: "Pasta onde clonar" });
    if (typeof dir === "string") setParent(dir.replace(/\\/g, "/"));
  };

  const dest = `${parent.replace(/[\\/]+$/, "")}/${name}`;
  const clone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !name.trim() || !parent.trim()) return;
    setBusy(true);
    try {
      const info = await git.cloneRepo(url.trim(), dest);
      updateSettings({ cloneDir: parent }); // next clone starts in the same folder
      toast.success(`${info.name} clonado`);
      onOpenChange(false);
      onCloned(info.path);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        {/* min-w-0: long descriptions must truncate instead of widening the dialog */}
        <form onSubmit={clone} className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitFork className="size-4 text-primary" /> Clonar repositório
            </DialogTitle>
            <DialogDescription>Escolha um dos seus repositórios do GitHub ou cole a URL.</DialogDescription>
          </DialogHeader>

          <div className="overflow-hidden rounded-lg border">
            <div className="relative border-b">
              <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-9 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Filtrar seus repositórios"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="h-56 overflow-y-auto p-1">
              {repoError ? (
                <p className="p-3 text-sm text-muted-foreground">{repoError}</p>
              ) : !repos ? (
                <Loader2 className="mx-auto mt-8 size-5 animate-spin text-primary" />
              ) : (
                shown.map((r) => (
                  <button
                    type="button"
                    key={r.url}
                    onClick={() => choose(r.url)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-muted",
                      url === r.url && "bg-accent shadow-[inset_2px_0_0_var(--primary)]",
                    )}
                  >
                    {r.private ? <Lock className="mt-0.5 size-3.5 shrink-0 text-warning" /> : <Github className="mt-0.5 size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.nameWithOwner}</span>
                      {r.description && <span className="block truncate text-xs text-muted-foreground">{r.description}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{relativeDate(Date.parse(r.updatedAt) / 1000)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="clone-url" className="flex items-center gap-1.5">
              <Globe className="size-3.5" /> URL
            </Label>
            <Input id="clone-url" className="font-mono text-xs" placeholder="https://github.com/usuario/repo.git" value={url} onChange={(e) => choose(e.target.value)} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex flex-col gap-2">
              <Label>Pasta</Label>
              <div className="flex gap-2">
                <Input className="font-mono text-xs" value={parent} onChange={(e) => setParent(e.target.value)} />
                <Button type="button" size="icon" variant="outline" aria-label="Escolher pasta" onClick={pick}>
                  <FolderOpen />
                </Button>
              </div>
            </div>
            <div className="flex w-40 flex-col gap-2">
              <Label>Nome</Label>
              <Input className="font-mono text-xs" value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ""))} />
            </div>
          </div>
          {name && parent && <p className="truncate font-mono text-[11px] text-muted-foreground">→ {dest}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !url.trim() || !name.trim() || !parent.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <GitFork />} {busy ? "Clonando..." : "Clonar e abrir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
