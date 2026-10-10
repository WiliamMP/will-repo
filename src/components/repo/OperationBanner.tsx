import { AlertTriangle, Play, SkipForward, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RepoApi } from "@/hooks/use-repo";
import { confirm } from "@/lib/confirm";
import { git, type OpAction } from "@/lib/git";

/** Shown while a merge/rebase/cherry-pick/revert is unfinished */
export function OperationBanner({ api, onShowConflicts }: { api: RepoApi; onShowConflicts: () => void }) {
  const { data, busy, run } = api;
  if (!data?.state.kind) return null;
  const { kind, label, step } = data.state;
  const conflicts = data.status.conflicted.length;
  const name = { merge: "Merge", rebase: "Rebase", "cherry-pick": "Cherry-pick", revert: "Revert" }[kind];

  const act = async (action: OpAction) => {
    if (action === "abort") {
      const ok = await confirm(`Cancelar o ${name.toLowerCase()} e voltar ao estado anterior?`, `Abortar ${name}`, "Abortar");
      if (!ok) return;
    }
    const done = { continue: `${name} continuado`, abort: `${name} abortado`, skip: "Commit pulado" }[action];
    run(name.toLowerCase(), (p) => git.operation(p, action), done);
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">
          {name} em andamento{step && ` (${step})`}
        </span>
        <span className="ml-2 truncate text-muted-foreground">{label}</span>
        <span className="ml-2">
          {conflicts > 0 ? (
            <button className="text-destructive underline-offset-2 hover:underline" onClick={onShowConflicts}>
              {conflicts} arquivo(s) com conflito
            </button>
          ) : (
            <span className="text-success">Sem conflitos: pode continuar</span>
          )}
        </span>
      </div>
      <Button size="xs" disabled={!!busy || conflicts > 0} onClick={() => act("continue")}>
        <Play /> Continuar
      </Button>
      {kind === "rebase" && (
        <Button size="xs" variant="outline" disabled={!!busy} onClick={() => act("skip")}>
          <SkipForward /> Pular commit
        </Button>
      )}
      <Button size="xs" variant="destructive" disabled={!!busy} onClick={() => act("abort")}>
        <X /> Abortar
      </Button>
    </div>
  );
}
