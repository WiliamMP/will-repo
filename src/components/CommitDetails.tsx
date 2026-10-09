import { useEffect, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffView } from "@/components/DiffView";
import { FileList } from "@/components/FileList";
import { git, type Commit, type DiffLine, type FileChange, type Stash } from "@/lib/git";

/** Text with "#123" turned into links to `${github}/issues/123` (GitHub redirects PR numbers) */
export function IssueLinks({ text, github }: { text: string; github: string | null }) {
  if (!github) return text;
  // split with a capture group keeps the numbers at the odd indexes
  return text.split(/(?<![\w&])#(\d+)\b/).map((part, i) =>
    i % 2 ? (
      <button
        key={i}
        className="text-primary underline-offset-2 hover:underline"
        title={`Abrir #${part} no GitHub`}
        onClick={() => openUrl(`${github}/issues/${part}`).catch((e) => toast.error(String(e)))}
      >
        #{part}
      </button>
    ) : (
      part
    ),
  );
}

type CommitProps = { repo: string; commit: Commit; github: string | null };

export function CommitDetails({ repo, commit, github }: CommitProps) {
  // The log only brings the subject; the body comes with the full message
  const [body, setBody] = useState("");
  useEffect(() => {
    setBody("");
    let stale = false;
    git.commitMessage(repo, commit.hash).then(
      (m) => !stale && setBody(m.split("\n").slice(1).join("\n").trim()),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [repo, commit.hash]);

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
          <h2 className="my-1 text-base font-semibold select-text">
            <IssueLinks text={commit.subject} github={github} />
          </h2>
          <p className="text-xs text-muted-foreground">
            {commit.author} · {new Date(commit.timestamp * 1000).toLocaleString("pt-BR")}
          </p>
          {body && (
            <p className="mt-2 max-h-32 overflow-auto text-sm whitespace-pre-wrap text-muted-foreground select-text">
              <IssueLinks text={body} github={github} />
            </p>
          )}
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
