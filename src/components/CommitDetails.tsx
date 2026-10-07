import { useEffect, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffView } from "@/components/DiffView";
import { FileList } from "@/components/FileList";
import { git, type Commit, type DiffLine, type FileChange, type Stash } from "@/lib/git";

export function CommitDetails({ repo, commit }: { repo: string; commit: Commit }) {
  return (
    <ChangeDetails
      id={commit.hash}
      loadFiles={() => git.commitFiles(repo, commit.hash)}
      loadDiff={(file) => git.commitDiff(repo, commit.hash, file)}
      header={
        <>
          <div className="flex items-center gap-1">
            <code className="text-xs text-primary">{commit.hash.slice(0, 10)}</code>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copiar hash"
              onClick={() => navigator.clipboard.writeText(commit.hash).then(() => toast.success("Hash copiado"))}
            >
              <Copy />
            </Button>
          </div>
          <h2 className="my-1 text-base font-semibold select-text">{commit.subject}</h2>
          <p className="text-xs text-muted-foreground">
            {commit.author} · {new Date(commit.timestamp * 1000).toLocaleString("pt-BR")}
          </p>
        </>
      }
    />
  );
}

export function StashDetails({ repo, stash, actions }: { repo: string; stash: Stash; actions: ReactNode }) {
  return (
    <ChangeDetails
      id={stash.name + stash.timestamp}
      loadFiles={() => git.stashFiles(repo, stash.name)}
      loadDiff={(file) => git.stashDiff(repo, stash.name, file)}
      header={
        <>
          <code className="text-xs text-primary">{stash.name}</code>
          <h2 className="my-1 text-base font-semibold select-text">{stash.message}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{new Date(stash.timestamp * 1000).toLocaleString("pt-BR")}</p>
          <div className="flex gap-2">{actions}</div>
        </>
      }
    />
  );
}

type Props = {
  /** Changes when another commit/stash is selected; reloads everything */
  id: string;
  header: ReactNode;
  loadFiles: () => Promise<FileChange[]>;
  loadDiff: (file: string) => Promise<DiffLine[]>;
};

// Shared layout: header, changed files, diff of the clicked file
function ChangeDetails({ id, header, loadFiles, loadDiff }: Props) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);

  // `stale` ignores answers that arrive after the user already clicked something else
  useEffect(() => {
    let stale = false;
    loadFiles().then(
      (f) => {
        if (stale) return;
        setFiles(f);
        setFile(f[0]?.path ?? null);
      },
      (e) => toast.error(String(e)),
    );
    return () => {
      stale = true;
    };
    // loaders are new functions every render; reload only when the selection (id) changes
  }, [id]);

  useEffect(() => {
    setDiff(null);
    if (!file) return;
    let stale = false;
    loadDiff(file).then((d) => !stale && setDiff(d), (e) => toast.error(String(e)));
    return () => {
      stale = true;
    };
  }, [id, file]);

  return (
    <>
      <div className="border-b p-4">{header}</div>
      <ScrollArea className="max-h-[35%] shrink-0 border-b">
        <FileList files={files} selected={file ?? undefined} onSelect={(f) => setFile(f.path)} showStats />
      </ScrollArea>
      <DiffView lines={diff} />
    </>
  );
}
