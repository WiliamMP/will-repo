import { useEffect, useState, type ReactNode } from "react";
import { BadgeCheck, Copy, FolderTree, ShieldAlert, ShieldQuestion, UserRoundSearch } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffView } from "@/components/DiffView";
import { ImageDiff, isImage } from "@/components/ImageDiff";
import { FileList } from "@/components/FileList";
import { git, type Commit, type SignatureInfo, type DiffLine, type FileChange, type Stash } from "@/lib/git";

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

type CommitProps = {
  repo: string;
  commit: Commit;
  github: string | null;
  /** open the file browser at this commit, optionally on one file's blame */
  onBrowse: (path?: string) => void;
};

export function CommitDetails({ repo, commit, github, onBrowse }: CommitProps) {
  // The log only brings the subject; the body comes with the full message
  const [body, setBody] = useState("");
  const [signature, setSignature] = useState<SignatureInfo | null>(null);
  useEffect(() => {
    setSignature(null);
    let stale = false;
    git.commitSignature(repo, commit.hash).then((s) => !stale && setSignature(s), () => {});
    return () => {
      stale = true;
    };
  }, [repo, commit.hash]);
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
      fileActions={(f) =>
        f.status !== "D" && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Blame e histórico"
            title="Blame e histórico do arquivo"
            onClick={(e) => {
              e.stopPropagation();
              onBrowse(f.path);
            }}
          >
            <UserRoundSearch />
          </Button>
        )
      }
      // merge commits compare with the first parent, like the text diff
      loadImages={(file) => Promise.all([git.blob(repo, `${commit.hash}^`, file), git.blob(repo, commit.hash, file)])}
      header={
        <>
          <div className="flex items-center gap-1">
            <code className="text-xs text-primary">{commit.hash.slice(0, 10)}</code>
            <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" title="Todos os arquivos deste commit" onClick={() => onBrowse()}>
              <FolderTree /> Arquivos
            </Button>
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
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {commit.author} · {new Date(commit.timestamp * 1000).toLocaleString("pt-BR")}
            {signature && <SignatureBadge info={signature} />}
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
      loadImages={(file) => Promise.all([git.blob(repo, `${stash.name}^1`, file), git.blob(repo, stash.name, file)])}
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
  /** old and new bytes, for image files */
  loadImages: (file: string) => Promise<[ArrayBuffer, ArrayBuffer]>;
  fileActions?: (file: FileChange) => ReactNode;
};

// Shared layout: header, changed files, diff of the clicked file
function ChangeDetails({ id, header, loadFiles, loadDiff, loadImages, fileActions }: Props) {
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
    if (!file || isImage(file)) return; // images get ImageDiff instead of a text diff
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
        <FileList files={files} selected={file ?? undefined} onSelect={(f) => setFile(f.path)} showStats actions={fileActions} />
      </ScrollArea>
      {file && isImage(file) ? (
        <ImageDiff path={file} version={id} load={() => loadImages(file)} />
      ) : (
        <DiffView lines={diff} />
      )}
    </>
  );
}

/** "Verificado" when git could check the commit's signature (GPG or SSH) */
function SignatureBadge({ info }: { info: SignatureInfo }) {
  const by = info.signer ? ` por ${info.signer}` : "";
  if (info.status === "N") return null;
  if (info.status === "G")
    return (
      <span className="flex items-center gap-1 rounded border border-success/40 bg-success/10 px-1.5 text-[11px] text-success" title={`Assinatura válida${by}`}>
        <BadgeCheck className="size-3" /> Verificado
      </span>
    );
  if (info.status === "B" || info.status === "R")
    return (
      <span className="flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 text-[11px] text-destructive" title={`Assinatura inválida ou revogada${by}`}>
        <ShieldAlert className="size-3" /> Assinatura inválida
      </span>
    );
  // U, X, Y, E: signed, but the key isn't trusted/known here or has expired
  return (
    <span className="flex items-center gap-1 rounded border px-1.5 text-[11px]" title={`Assinado${by}, mas a chave não pôde ser confirmada nesta máquina`}>
      <ShieldQuestion className="size-3" /> Assinado
    </span>
  );
}
