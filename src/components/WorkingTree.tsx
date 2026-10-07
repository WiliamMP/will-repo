import { useEffect, useState } from "react";
import { GitCommitHorizontal, Minus, Plus, Undo2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { BorderBeam } from "@/components/ui/border-beam";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { DiffView } from "@/components/DiffView";
import { FileList } from "@/components/FileList";
import { git, type DiffLine, type FileChange, type Status } from "@/lib/git";

type Props = {
  repo: string;
  status: Status;
  run: (label: string, action: (path: string) => Promise<unknown>, success?: string) => Promise<boolean>;
};

// "Commit" tab: unstaged/staged lists, diff of the clicked file, message box
export function WorkingTree({ repo, status, run }: Props) {
  const [pick, setPick] = useState<{ file: FileChange; staged: boolean } | null>(null);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [message, setMessage] = useState("");

  // Reload the diff when the file is picked or the status changes (after stage, etc.)
  useEffect(() => {
    setDiff(null);
    if (!pick) return;
    const list = pick.staged ? status.staged : status.unstaged;
    if (!list.some((f) => f.path === pick.file.path)) return setPick(null);
    let stale = false;
    git.workingDiff(repo, pick.file, pick.staged).then((d) => !stale && setDiff(d), (e) => toast.error(String(e)));
    return () => {
      stale = true;
    };
  }, [repo, pick, status]);

  const stage = (files: FileChange[]) => run("stage", (p) => git.stage(p, files.map((f) => f.path)));
  const unstage = (files: FileChange[]) => run("unstage", (p) => git.unstage(p, files.map((f) => f.path)));

  const discard = async (files: FileChange[]) => {
    const names = files.map((f) => f.path).join("\n");
    const ok = await ask(`Descartar alterações? Isso não pode ser desfeito.\n\n${names}`, {
      title: "Descartar",
      kind: "warning",
      okLabel: "Descartar",
      cancelLabel: "Cancelar",
    });
    if (ok) run("discard", (p) => git.discard(p, files));
  };

  const commit = async () => {
    if (!message.trim() || status.staged.length === 0) return;
    if (await run("commit", (p) => git.commit(p, message.trim()), "Commit criado")) setMessage("");
  };

  const iconBtn = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </Button>
  );

  return (
    <>
      <ScrollArea className="max-h-[45%] shrink-0 border-b">
        <ListHeader title={`Não preparados (${status.unstaged.length})`}>
          {status.unstaged.length > 0 && (
            <>
              <Button variant="ghost" size="xs" onClick={() => discard(status.unstaged)}>
                <Undo2 /> Descartar tudo
              </Button>
              <Button variant="ghost" size="xs" onClick={() => stage(status.unstaged)}>
                <Plus /> Preparar tudo
              </Button>
            </>
          )}
        </ListHeader>
        <FileList
          files={status.unstaged}
          selected={pick && !pick.staged ? pick.file.path : undefined}
          onSelect={(file) => setPick({ file, staged: false })}
          actions={(f) => (
            <>
              {iconBtn("Descartar", <Undo2 />, () => discard([f]))}
              {iconBtn("Preparar", <Plus />, () => stage([f]))}
            </>
          )}
        />
        <ListHeader title={`Preparados (${status.staged.length})`}>
          {status.staged.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => unstage(status.staged)}>
              <Minus /> Remover tudo
            </Button>
          )}
        </ListHeader>
        <FileList
          files={status.staged}
          selected={pick?.staged ? pick.file.path : undefined}
          onSelect={(file) => setPick({ file, staged: true })}
          actions={(f) => iconBtn("Remover do stage", <Minus />, () => unstage([f]))}
        />
      </ScrollArea>

      <DiffView lines={pick ? diff : null} />

      <div className="flex flex-col gap-2 border-t p-3">
        <div className="relative overflow-hidden rounded-lg">
          <Textarea
            placeholder="Mensagem do commit... (Ctrl+Enter)"
            className="min-h-20 resize-none bg-background"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.ctrlKey && e.key === "Enter" && commit()}
          />
          {message.trim() && status.staged.length > 0 && (
            <BorderBeam size={80} duration={8} colorFrom="var(--primary)" colorTo="var(--lane-2)" />
          )}
        </div>
        <div className="flex justify-end">
          <ShimmerButton
            background="var(--primary)"
            borderRadius="8px"
            shimmerColor="#c4b5ff"
            className="h-7 gap-1.5 px-3 text-[0.8rem] font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!message.trim() || status.staged.length === 0}
            onClick={commit}
          >
            <GitCommitHorizontal className="size-3.5" /> Commit
          </ShimmerButton>
        </div>
      </div>
    </>
  );
}

function ListHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-1 px-3 pt-1 text-[11px] tracking-wider text-muted-foreground uppercase">
      <span className="mr-auto">{title}</span>
      {children}
    </div>
  );
}
