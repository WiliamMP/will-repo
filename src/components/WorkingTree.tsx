import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, GitCommitHorizontal, Minus, Plus, Undo2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { BorderBeam } from "@/components/ui/border-beam";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { CommitAssist } from "@/components/CommitAssist";
import { ConflictView, sideNames } from "@/components/ConflictView";
import { DiffView } from "@/components/DiffView";
import { ImageDiff, isImage } from "@/components/ImageDiff";
import { DiscardsDialog } from "@/components/DiscardsDialog";
import { FileList } from "@/components/FileList";
import { git, openInEditor, type DiffLine, type FileChange, type HunkAction, type RepoState, type Status } from "@/lib/git";
import { cn } from "@/lib/utils";

type Props = {
  repo: string;
  status: Status;
  state: RepoState;
  /** last commit is already on the remote: amending it needs a force push */
  headPushed: boolean;
  /** recent commit subjects for the message assistant */
  recent: string[];
  run: (label: string, action: (path: string) => Promise<unknown>, success?: string) => Promise<boolean>;
};

// "Commit" tab: unstaged/staged lists, diff of the clicked file, message box
type List = "unstaged" | "staged" | "conflicted";

export function WorkingTree({ repo, status, state, headPushed, recent, run }: Props) {
  const [pick, setPick] = useState<{ file: FileChange; list: List } | null>(null);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [message, setMessage] = useState("");
  // changes on every status refresh, so the image diff reloads after stage/discard
  const statusVersion = useMemo(() => Math.random().toString(36), [status]);
  const [amend, setAmend] = useState(false);

  // Reload the diff when the file is picked or the status changes (after stage, etc.)
  useEffect(() => {
    setDiff(null);
    if (!pick) return;
    if (!status[pick.list].some((f) => f.path === pick.file.path)) return setPick(null);
    if (pick.list === "conflicted") return; // ConflictView loads its own content
    let stale = false;
    git.workingDiff(repo, pick.file, pick.list === "staged").then((d) => !stale && setDiff(d), (e) => toast.error(String(e)));
    return () => {
      stale = true;
    };
  }, [repo, pick, status]);

  const stage = (files: FileChange[]) => run("stage", (p) => git.stage(p, files.map((f) => f.path)));
  const unstage = (files: FileChange[]) => run("unstage", (p) => git.unstage(p, files.map((f) => f.path)));

  // Discards are backed up in Rust, so no confirmation: a toast offers "Desfazer" instead
  const restore = (hash: string) => run("restore", (p) => git.restoreDiscard(p, hash), "Alterações restauradas");
  const offerUndo = (what: string) =>
    toast.success(`${what} descartado(s)`, {
      duration: 10000,
      action: {
        label: "Desfazer",
        onClick: () => git.discardList(repo).then(([last]) => last && restore(last.hash), (e) => toast.error(String(e))),
      },
    });

  const discard = async (files: FileChange[]) => {
    const what = files.length === 1 ? files[0].path : `${files.length} arquivos`;
    if (await run("discard", (p) => git.discard(p, files))) offerUndo(what);
  };

  // Hunk = one "@@" block of the diff. With lines selected, only those lines are used.
  const hunk = async (index: number, action: HunkAction, lines: number[]) => {
    if (!pick) return;
    const ok = await run("trecho", (p) => git.applyHunk(p, pick.file.path, index, action, lines.length ? lines : undefined));
    if (ok && action === "discard") offerUndo(lines.length ? `${lines.length} linha(s)` : "Trecho");
  };

  const hunkActions = (index: number, lines: number[]) => {
    const what = lines.length ? `${lines.length} linha${lines.length > 1 ? "s" : ""}` : "trecho";
    const btn = (action: HunkAction, icon: React.ReactNode, label: string, danger = false) => (
      <Button
        variant="outline"
        size="xs"
        className={cn("h-5 bg-card", danger && "text-destructive", lines.length && "border-primary/60")}
        onClick={(e) => {
          e.stopPropagation();
          hunk(index, action, lines);
        }}
      >
        {icon} {label} {what}
      </Button>
    );
    return pick?.list === "staged" ? (
      btn("unstage", <Minus />, "Remover")
    ) : (
      <>
        {btn("stage", <Plus />, "Preparar")}
        {btn("discard", <Undo2 />, "Descartar", true)}
      </>
    );
  };

  // Amend = rewrite the last commit; starts from its message. Git refuses it mid merge/rebase.
  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (on && !message.trim()) {
      try {
        setMessage(await git.headMessage(repo));
      } catch (e) {
        toast.error(String(e));
      }
    }
  };

  // During a rebase, commits are made by "Continuar" in the banner
  const canCommit = !!message.trim() && (status.staged.length > 0 || amend) && state.kind !== "rebase";
  const commit = async () => {
    if (!canCommit) return;
    if (amend && headPushed) {
      const ok = await ask(
        "O último commit já foi enviado (push). Alterá-lo reescreve o histórico e o próximo push vai precisar ser forçado.",
        { title: "Amend", kind: "warning", okLabel: "Alterar mesmo assim", cancelLabel: "Cancelar" },
      );
      if (!ok) return;
    }
    const done = amend ? "Último commit alterado" : "Commit criado";
    if (await run("commit", (p) => git.commit(p, message.trim(), amend), done)) {
      setMessage("");
      setAmend(false);
    }
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

  const names = sideNames(state.kind);
  const resolveFile = (f: FileChange, choice: "ours" | "theirs") =>
    run("conflito", (p) => git.resolveFile(p, f.path, choice));

  return (
    <>
      <ScrollArea className="max-h-[45%] shrink-0 border-b">
        {status.conflicted.length > 0 && (
          <div className="border-b border-destructive/30 bg-destructive/5">
            <ListHeader title={`Conflitos (${status.conflicted.length})`} />
            <FileList
              files={status.conflicted}
              selected={pick?.list === "conflicted" ? pick.file.path : undefined}
              onSelect={(file) => setPick({ file, list: "conflicted" })}
              actions={(f) => (
                <>
                  {iconBtn("Abrir no editor", <ExternalLink />, () => openInEditor(repo, f.path))}
                  <Button variant="ghost" size="xs" title={`Arquivo inteiro: ${names.ours}`} onClick={(e) => {
                    e.stopPropagation();
                    resolveFile(f, "ours");
                  }}>
                    Atual
                  </Button>
                  <Button variant="ghost" size="xs" title={`Arquivo inteiro: ${names.theirs}`} onClick={(e) => {
                    e.stopPropagation();
                    resolveFile(f, "theirs");
                  }}>
                    Recebida
                  </Button>
                  {iconBtn("Marcar como resolvido", <Check />, () => stage([f]))}
                </>
              )}
            />
          </div>
        )}
        <ListHeader title={`Não preparados (${status.unstaged.length})`}>
          <DiscardsDialog repo={repo} onRestore={restore} />
          {status.unstaged.length > 0 && (
            <>
              <Button variant="ghost" size="xs" title="Descartar todas as alterações não preparadas" onClick={() => discard(status.unstaged)}>
                <Undo2 /> Descartar
              </Button>
              <Button variant="ghost" size="xs" title="Preparar todos os arquivos" onClick={() => stage(status.unstaged)}>
                <Plus /> Preparar
              </Button>
            </>
          )}
        </ListHeader>
        <FileList
          files={status.unstaged}
          selected={pick?.list === "unstaged" ? pick.file.path : undefined}
          onSelect={(file) => setPick({ file, list: "unstaged" })}
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
          selected={pick?.list === "staged" ? pick.file.path : undefined}
          onSelect={(file) => setPick({ file, list: "staged" })}
          actions={(f) => iconBtn("Remover do stage", <Minus />, () => unstage([f]))}
        />
      </ScrollArea>

      {pick?.list === "conflicted" ? (
        <ConflictView repo={repo} file={pick.file.path} kind={state.kind} version={status} run={run} />
      ) : (
        <>
          {pick && pick.file.status !== "?" && !isImage(pick.file.path) && (
            <p className="border-b bg-sidebar px-3 py-1 text-[11px] text-muted-foreground">
              Clique nas linhas +/- para escolher só algumas · Shift+clique seleciona um intervalo
            </p>
          )}
          {pick && isImage(pick.file.path) ? (
            // staged: last commit -> index; not staged: index -> file on disk
            <ImageDiff
              path={pick.file.path}
              version={`${pick.list}:${statusVersion}`}
              load={() =>
                Promise.all(
                  pick.list === "staged"
                    ? [git.blob(repo, "HEAD", pick.file.path), git.blob(repo, "INDEX", pick.file.path)]
                    : [git.blob(repo, "INDEX", pick.file.path), git.blob(repo, "WORKTREE", pick.file.path)],
                )
              }
            />
          ) : (
            <DiffView lines={pick ? diff : null} hunkActions={pick && pick.file.status !== "?" ? hunkActions : undefined} />
          )}
        </>
      )}

      <div className="flex flex-col gap-2 border-t p-3">
        <CommitAssist message={message} onChange={setMessage} recent={recent} disabled={state.kind === "rebase"} />
        <div className="relative overflow-hidden rounded-lg">
          <Textarea
            placeholder={state.kind === "rebase" ? "Rebase em andamento: use Continuar no aviso acima" : "Mensagem do commit... (Ctrl+Enter)"}
            disabled={state.kind === "rebase"}
            className="min-h-20 resize-none bg-background"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.ctrlKey && e.key === "Enter" && commit()}
          />
          {canCommit && (
            <BorderBeam size={80} duration={8} colorFrom="var(--primary)" colorTo="var(--lane-2)" />
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="amend"
              checked={amend}
              disabled={!!state.kind}
              onCheckedChange={(v) => toggleAmend(v === true)}
            />
            <Label htmlFor="amend" className="text-xs text-muted-foreground" title="Substitui o último commit pela mensagem e arquivos preparados">
              Alterar último commit
            </Label>
          </div>
          <ShimmerButton
            background="var(--primary)"
            borderRadius="8px"
            shimmerColor="#c4b5ff"
            className="h-7 gap-1.5 px-3 text-[0.8rem] font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canCommit}
            onClick={commit}
          >
            <GitCommitHorizontal className="size-3.5" /> {amend ? "Amend" : "Commit"}
          </ShimmerButton>
        </div>
      </div>
    </>
  );
}

function ListHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-1 px-3 pt-1 text-[11px] tracking-wider text-muted-foreground uppercase">
      <span className="mr-auto whitespace-nowrap">{title}</span>
      {children}
    </div>
  );
}
