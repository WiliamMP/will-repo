import { ArrowDown, ArrowUp, Check, GitBranch, Loader2 } from "lucide-react";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import type { Tracking } from "@/lib/git";

type Props = { head: string | null; tracking: Tracking; loaded: number; busy: string | null };

/** Status bar: branch, ahead/behind the upstream, loaded commits, what is running */
export function RepoFooter({ head, tracking, loaded, busy }: Props) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-card px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <GitBranch className="size-3.5" /> {head ?? "HEAD destacado"}
      </span>
      {tracking.upstream ? (
        <>
          <span className="flex items-center gap-2" title={`Comparado com ${tracking.upstream}`}>
            <span className="flex items-center">
              <ArrowUp className="size-3.5" />
              {tracking.ahead}
            </span>
            <span className="flex items-center">
              <ArrowDown className="size-3.5" />
              {tracking.behind}
            </span>
          </span>
          {tracking.ahead === 0 && tracking.behind === 0 && (
            <AnimatedShinyText className="mx-0 flex items-center gap-1 text-xs">
              <Check className="size-3.5" /> Sincronizado com {tracking.upstream}
            </AnimatedShinyText>
          )}
        </>
      ) : (
        <span>Sem upstream</span>
      )}
      <span className="ml-auto">{loaded} commits carregados</span>
      {busy && (
        <span className="flex items-center gap-1 text-primary">
          <Loader2 className="size-3.5 animate-spin" /> {busy}...
        </span>
      )}
    </footer>
  );
}
