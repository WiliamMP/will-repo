import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleDot, CircleX, GitPullRequest, GitPullRequestDraft, Loader2, Plus, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { git, relativeDate, type PullRequest, type PullRequests as Prs, type Tracking } from "@/lib/git";
import { cn } from "@/lib/utils";

type Props = {
  repo: string;
  head: string | null;
  tracking: Tracking;
  run: (label: string, action: (path: string) => Promise<unknown>, success?: string) => Promise<boolean>;
};

const open = (url: string) => openUrl(url).catch((e) => toast.error(String(e)));

// "Pull Requests" tab: open PRs of the GitHub repo behind origin + form to open one from the current branch.
// The tab content mounts only while visible, so the list loads each time the tab is opened.
export function PullRequests({ repo, head, tracking, run }: Props) {
  const [prs, setPrs] = useState<Prs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPrs(await git.githubPrs(repo));
      setError(null);
    } catch (e) {
      const msg = String(e);
      setError(
        msg.startsWith("not_logged")
          ? "Entre no GitHub pelo dashboard para ver os pull requests."
          : msg.startsWith("offline")
            ? "Sem internet."
            : msg,
      );
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    load();
  }, [load]);

  const mine = prs?.items.find((p) => p.head === head);
  const canCreate = !!prs && !!head && head !== prs.defaultBranch && !mine;

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <span className="mr-auto text-[11px] tracking-wider text-muted-foreground uppercase">
          Abertos {prs && `(${prs.items.length})`}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Atualizar" title="Atualizar" disabled={loading} onClick={load}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
        <Button
          size="xs"
          disabled={!canCreate || creating}
          title={mine ? `A branch ${head} já tem o PR #${mine.number}` : undefined}
          onClick={() => setCreating(true)}
        >
          <Plus /> Novo PR
        </Button>
      </div>

      {creating && prs && head && (
        <CreateForm
          repo={repo}
          head={head}
          base={prs.defaultBranch}
          needsPush={!tracking.upstream || tracking.ahead > 0}
          run={run}
          onDone={(created) => {
            setCreating(false);
            if (created) load();
          }}
        />
      )}

      <ScrollArea className="min-h-0 flex-1">
        {error && <p className="p-4 text-muted-foreground">{error}</p>}
        {prs?.items.length === 0 && <p className="p-4 text-muted-foreground">Nenhum pull request aberto.</p>}
        {prs?.items.map((pr) => (
          <PrRow key={pr.number} pr={pr} current={pr.head === head} />
        ))}
      </ScrollArea>
    </>
  );
}

function PrRow({ pr, current }: { pr: PullRequest; current: boolean }) {
  const Icon = pr.draft ? GitPullRequestDraft : GitPullRequest;
  return (
    <button
      onClick={() => open(pr.url)}
      title="Abrir no GitHub"
      className={cn(
        "flex w-full items-start gap-2 border-b px-3 py-2 text-left hover:bg-muted/60",
        current && "bg-accent shadow-[inset_2px_0_0_var(--primary)]",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", pr.draft ? "text-muted-foreground" : "text-success")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{pr.title}</span>
          <Ci state={pr.ci} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>#{pr.number}</span>
          <span>{pr.author}</span>
          <span className="font-mono">
            {pr.head} → {pr.base}
          </span>
          <span>{relativeDate(Date.parse(pr.updatedAt) / 1000)}</span>
          {pr.review === "APPROVED" && <Badge className="h-4 px-1 text-[10px]">Aprovado</Badge>}
          {pr.review === "CHANGES_REQUESTED" && (
            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
              Alterações pedidas
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function Ci({ state }: { state: PullRequest["ci"] }) {
  if (!state) return null;
  if (state === "SUCCESS") return <CircleCheck className="size-3.5 shrink-0 text-success" aria-label="CI passou" />;
  if (state === "FAILURE" || state === "ERROR")
    return <CircleX className="size-3.5 shrink-0 text-destructive" aria-label="CI falhou" />;
  return <CircleDot className="size-3.5 shrink-0 animate-pulse text-warning" aria-label="CI rodando" />;
}

type FormProps = {
  repo: string;
  head: string;
  base: string;
  needsPush: boolean;
  run: Props["run"];
  onDone: (created: boolean) => void;
};

function CreateForm({ repo, head, base: defaultBase, needsPush, run, onDone }: FormProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState(defaultBase);
  const [draft, setDraft] = useState(false);

  // Title starts as the last commit's subject, body as the rest of its message
  useEffect(() => {
    git.headMessage(repo).then((m) => {
      const [subject, ...rest] = m.split("\n");
      setTitle(subject);
      setBody(rest.join("\n").trim());
    });
  }, [repo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // GitHub only sees pushed commits: push first when the branch is new or ahead
    if (needsPush && !(await run("push", git.push))) return;
    let url = "";
    const ok = await run("pr", async (p) => {
      url = await git.githubCreatePr(p, title.trim(), body, base.trim(), draft);
    });
    if (!ok) return;
    toast.success("Pull request criado", { action: { label: "Abrir", onClick: () => open(url) } });
    onDone(true);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-b bg-sidebar p-3">
      <p className="text-xs text-muted-foreground">
        De <span className="font-mono text-foreground">{head}</span> para
      </p>
      <Input className="h-7 font-mono" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Branch de destino" />
      <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <Textarea
        placeholder="Descrição (markdown)"
        className="min-h-20 resize-none bg-background"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Checkbox id="pr-draft" checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
        <Label htmlFor="pr-draft" className="mr-auto text-xs text-muted-foreground">
          Rascunho
        </Label>
        <Button type="button" variant="ghost" size="xs" onClick={() => onDone(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="xs" disabled={!title.trim() || !base.trim()}>
          {needsPush ? "Push e criar PR" : "Criar PR"}
        </Button>
      </div>
    </form>
  );
}
