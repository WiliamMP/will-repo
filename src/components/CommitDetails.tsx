import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffView } from "@/components/DiffView";
import { FileList } from "@/components/FileList";
import { git, type Commit, type DiffLine, type FileChange } from "@/lib/git";

export function CommitDetails({ repo, commit }: { repo: string; commit: Commit }) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);

  // Load changed files when the selected commit changes.
  // `stale` ignores answers that arrive after the user already clicked another commit.
  useEffect(() => {
    let stale = false;
    git.commitFiles(repo, commit.hash).then(
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
  }, [repo, commit.hash]);

  useEffect(() => {
    setDiff(null);
    if (!file) return;
    let stale = false;
    git.commitDiff(repo, commit.hash, file).then((d) => !stale && setDiff(d), (e) => toast.error(String(e)));
    return () => {
      stale = true;
    };
  }, [repo, commit.hash, file]);

  return (
    <>
      <div className="border-b p-4">
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
      </div>
      <ScrollArea className="max-h-[35%] shrink-0 border-b">
        <FileList files={files} selected={file ?? undefined} onSelect={(f) => setFile(f.path)} showStats />
      </ScrollArea>
      <DiffView lines={diff} />
    </>
  );
}
