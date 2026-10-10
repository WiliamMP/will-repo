import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { CirclePlus, GitMerge, GitPullRequestArrow } from "lucide-react";
import type { RepoApi } from "@/hooks/use-repo";
import { git } from "@/lib/git";

type DropMenuProps = {
  source: string;
  target: string;
  x: number;
  y: number;
  head: string;
  /** remote branch names: checking one out creates a local branch */
  remotes: string[];
  run: RepoApi["run"];
  onClose: () => void;
};

/** What to do after dropping branch `source` onto branch `target` (like GitKraken) */
export function DropMenu({ source, target, x, y, head, remotes, run, onClose }: DropMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sourceLocal = source.replace(/^[^/]+\//, ""); // origin/x -> x, only to check if it is HEAD
  const options: { icon: LucideIcon; label: string; action: (p: string) => Promise<unknown>; done: string }[] = [];
  if (target === head) {
    options.push(
      { icon: GitMerge, label: `Mesclar ${source} em ${target}`, action: (p) => git.merge(p, source), done: `${source} mesclada em ${target}` },
      { icon: GitPullRequestArrow, label: `Rebase de ${target} sobre ${source}`, action: (p) => git.rebase(p, source), done: `Rebase concluído` },
      { icon: CirclePlus, label: `Cherry-pick do último commit de ${source}`, action: (p) => git.pick(p, source, false), done: `Commit de ${source} aplicado` },
    );
  } else if (source === head || sourceLocal === head) {
    options.push(
      { icon: GitPullRequestArrow, label: `Rebase de ${source} sobre ${target}`, action: (p) => git.rebase(p, target), done: `Rebase concluído` },
      { icon: GitMerge, label: `Mesclar ${target} em ${source}`, action: (p) => git.merge(p, target), done: `${target} mesclada em ${source}` },
    );
  } else {
    // neither is the current branch: checkout first
    options.push(
      {
        icon: GitMerge,
        label: `Checkout ${target} e mesclar ${source}`,
        action: async (p) => {
          await git.checkout(p, target, false);
          await git.merge(p, source);
        },
        done: `${source} mesclada em ${target}`,
      },
      {
        icon: GitPullRequestArrow,
        label: `Checkout ${source} e rebase sobre ${target}`,
        action: async (p) => {
          await git.checkout(p, source, remotes.includes(source));
          await git.rebase(p, target);
        },
        done: `Rebase de ${source} sobre ${target} concluído`,
      },
    );
  }

  return (
    <>
      {/* invisible layer: a click anywhere else closes the menu */}
      <div className="fixed inset-0 z-50" onMouseDown={onClose} />
      <div
        className="fixed z-50 min-w-64 overflow-hidden rounded-lg border bg-popover p-1 shadow-[0_0_40px_-10px_var(--glow)]"
        style={{ left: Math.min(x, window.innerWidth - 300), top: Math.min(y, window.innerHeight - 160) }}
      >
        <p className="px-2 py-1.5 text-[11px] tracking-wider text-muted-foreground uppercase">
          {source} → {target}
        </p>
        {options.map((o) => (
          <button
            key={o.label}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onClose();
              run("arrastar", o.action, o.done);
            }}
          >
            <o.icon className="size-4 text-primary" /> {o.label}
          </button>
        ))}
      </div>
    </>
  );
}
