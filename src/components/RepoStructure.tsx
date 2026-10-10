import { useEffect, useState } from "react";
import { AlertTriangle, Boxes, ExternalLink, FolderGit2, FolderOpen, FolderPlus, HardDrive, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { git, type LfsStatus, type Submodule, type Worktree } from "@/lib/git";
import { cn } from "@/lib/utils";

export type StructureActions = {
  /** open another repository folder in a new tab */
  openTab: (path: string) => void;
  updateSubmodules: (path?: string) => void;
  addWorktree: () => void;
  removeWorktree: (w: Worktree) => void;
  openLfs: () => void;
};

const item =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground";
const title = "mb-1 flex items-center text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase";

const SUB_STATE: Record<Submodule["state"], [string, string]> = {
  ok: ["", "Em dia"],
  uninitialized: ["text-warning", "Não baixado: use Atualizar"],
  modified: ["text-primary", "Em outro commit que o esperado"],
  conflict: ["text-destructive", "Conflito"],
};

/** Submodules and worktrees for the sidebar, plus the Git LFS entry */
export function StructureSections({ submodules, worktrees, actions }: { submodules: Submodule[]; worktrees: Worktree[]; actions: StructureActions }) {
  return (
    <>
      {submodules.length > 0 && (
        <div>
          <h3 className={title}>
            <span className="mr-auto">Submódulos</span>
            <button title="Baixar e atualizar todos" className="rounded p-0.5 hover:bg-muted hover:text-foreground" onClick={() => actions.updateSubmodules()}>
              <RefreshCw className="size-3" />
            </button>
          </h3>
          {submodules.map((s) => {
            const [tone, label] = SUB_STATE[s.state];
            return (
              <ContextMenu key={s.path}>
                <ContextMenuTrigger asChild>
                  <div
                    className={item}
                    title={`${s.path} · ${label}\nDuplo clique: abrir em nova aba`}
                    onDoubleClick={() => (s.state === "uninitialized" ? actions.updateSubmodules(s.path) : actions.openTab(s.absPath))}
                  >
                    <Boxes className={cn("size-3.5 shrink-0", tone)} />
                    <span className="truncate">{s.path}</span>
                    {s.state !== "ok" && <AlertTriangle className={cn("ml-auto size-3 shrink-0", tone)} />}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem disabled={s.state === "uninitialized"} onSelect={() => actions.openTab(s.absPath)}>
                    <ExternalLink /> Abrir em nova aba
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => actions.updateSubmodules(s.path)}>
                    <RefreshCw /> {s.state === "uninitialized" ? "Baixar" : "Atualizar para o commit esperado"}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}

      <div>
        <h3 className={title}>
          <span className="mr-auto">Worktrees</span>
          <button title="Nova worktree: outra branch em outra pasta" className="rounded p-0.5 hover:bg-muted hover:text-foreground" onClick={actions.addWorktree}>
            <Plus className="size-3" />
          </button>
        </h3>
        {worktrees.length <= 1 && <p className="px-2 text-[11px] text-muted-foreground/60">Só a pasta principal.</p>}
        {worktrees.length > 1 &&
          worktrees.map((w) => (
            <ContextMenu key={w.path}>
              <ContextMenuTrigger asChild>
                <div className={item} title={`${w.path}\nDuplo clique: abrir em nova aba`} onDoubleClick={() => !w.main && actions.openTab(w.path)}>
                  <FolderGit2 className={cn("size-3.5 shrink-0", w.main && "text-primary")} />
                  <span className="truncate">{w.branch ?? `(${w.head.slice(0, 7)})`}</span>
                  {w.main && <span className="ml-auto text-[10px] text-muted-foreground/70">principal</span>}
                </div>
              </ContextMenuTrigger>
              {!w.main && (
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => actions.openTab(w.path)}>
                    <ExternalLink /> Abrir em nova aba
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => actions.removeWorktree(w)}>
                    <Trash2 /> Remover pasta
                  </ContextMenuItem>
                </ContextMenuContent>
              )}
            </ContextMenu>
          ))}
      </div>

      <button className={cn(item, "mt-auto")} onClick={actions.openLfs}>
        <HardDrive className="size-3.5 shrink-0" /> Git LFS
      </button>
    </>
  );
}

// ---------- New worktree ----------

type WorktreeProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  repo: string;
  branches: string[];
  /** branches already checked out somewhere (git refuses them) */
  busy: string[];
  onCreate: (path: string, branch: string, newBranch: boolean) => Promise<boolean>;
};

export function WorktreeDialog({ open, onOpenChange, repo, branches, busy, onCreate }: WorktreeProps) {
  const free = branches.filter((b) => !busy.includes(b));
  const [isNew, setIsNew] = useState(free.length === 0);
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");

  // default folder: next to the repo, named after the branch (will-repo-feature-x)
  useEffect(() => {
    if (branch) setPath(`${repo.replace(/[\\/]+$/, "")}-${branch.replace(/[^\w.-]+/g, "-")}`);
  }, [branch, repo]);
  useEffect(() => {
    if (open) {
      setBranch(isNew ? "" : (free[0] ?? ""));
    }
  }, [open, isNew]);

  const pick = async () => {
    const dir = await openDialog({ directory: true, title: "Pasta onde criar a worktree" });
    if (typeof dir === "string") setPath(`${dir.replace(/[\\/]+$/, "")}/${branch.replace(/[^\w.-]+/g, "-") || "worktree"}`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (branch.trim() && path.trim() && (await onCreate(path.trim(), branch.trim(), isNew))) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="size-4 text-primary" /> Nova worktree
            </DialogTitle>
            <DialogDescription>Outra branch aberta em outra pasta, ao mesmo tempo. Abre numa aba nova.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Checkbox id="wt-new" checked={isNew} onCheckedChange={(v) => setIsNew(v === true)} />
            <Label htmlFor="wt-new">Criar uma branch nova (a partir do HEAD)</Label>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Branch</Label>
            {isNew ? (
              <Input autoFocus placeholder="feature/paralela" value={branch} onChange={(e) => setBranch(e.target.value.replace(/\s/g, "-"))} />
            ) : (
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Nenhuma branch livre" />
                </SelectTrigger>
                <SelectContent>
                  {free.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label>Pasta</Label>
            <div className="flex gap-2">
              <Input className="font-mono text-xs" value={path} onChange={(e) => setPath(e.target.value)} />
              <Button type="button" size="icon" variant="outline" aria-label="Escolher pasta" onClick={pick}>
                <FolderOpen />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!branch.trim() || !path.trim()}>
              Criar e abrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Git LFS ----------

export function LfsDialog({ open, onOpenChange, repo }: { open: boolean; onOpenChange: (o: boolean) => void; repo: string }) {
  const [status, setStatus] = useState<LfsStatus | null>(null);
  const [pattern, setPattern] = useState("");

  const load = () => git.lfsStatus(repo).then(setStatus, (e) => toast.error(String(e)));
  useEffect(() => {
    if (open) {
      setStatus(null);
      load();
    }
  }, [open, repo]);

  const track = async (p: string, on: boolean) => {
    try {
      await git.lfsTrack(repo, p, on);
      toast.success(on ? `${p} agora vai para o LFS (.gitattributes alterado)` : `${p} não vai mais para o LFS`);
      setPattern("");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="size-4 text-primary" /> Git LFS
          </DialogTitle>
          <DialogDescription>Arquivos grandes (imagens, vídeos, binários) guardados fora do histórico do git.</DialogDescription>
        </DialogHeader>
        {!status ? (
          <Loader2 className="mx-auto size-5 animate-spin text-primary" />
        ) : !status.installed ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            O git-lfs não está instalado. Instale em <code>git-lfs.com</code> e rode <code>git lfs install</code>.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Padrões rastreados</p>
              <div className="flex flex-wrap gap-1.5">
                {status.patterns.length === 0 && <span className="text-sm text-muted-foreground">Nenhum.</span>}
                {status.patterns.map((p) => (
                  <span key={p} className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 py-0.5 pr-0.5 pl-2 font-mono text-xs text-primary">
                    {p}
                    <button title="Parar de rastrear" className="rounded p-0.5 hover:bg-primary/20" onClick={() => track(p, false)}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pattern.trim()) track(pattern.trim(), true);
                }}
              >
                <Input className="font-mono text-xs" placeholder="*.psd" value={pattern} onChange={(e) => setPattern(e.target.value)} />
                <Button type="submit" size="sm" disabled={!pattern.trim()}>
                  <Plus /> Rastrear
                </Button>
              </form>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Arquivos no LFS ({status.files.length})</p>
              <div className="max-h-48 overflow-y-auto rounded-lg border bg-sidebar p-1 font-mono text-xs">
                {status.files.length === 0 ? (
                  <p className="p-2 font-sans text-muted-foreground">Nenhum arquivo ainda.</p>
                ) : (
                  status.files.map((f) => (
                    <p key={f} className="truncate px-2 py-0.5">
                      {f}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
