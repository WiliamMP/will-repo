import { useEffect, useState } from "react";
import {
  Check,
  Code2,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Info,
  Keyboard,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Sun,
  Trash2,
  UserRound,
  UserRoundPen,
} from "lucide-react";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Avatar, Github, GithubLogin, useGithub } from "@/components/Dashboard";
import { Related, Row, Section, StopSlider, type Page } from "@/components/Settings";
import { DEFAULTS, updateSettings, useSettings, type Settings } from "@/hooks/use-settings";
import type { ThemeMode } from "@/hooks/use-theme";
import { git, type Identity, type Signing } from "@/lib/git";
import { cn } from "@/lib/utils";

export type PageId = "account" | "identity" | "appearance" | "git" | "diff" | "integrations" | "shortcuts" | "about";

export type SettingsContext = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  goTo: (page: PageId, section?: string) => void;
};

const SHORTCUTS: { id: string; title: string; items: [string, string[]][] }[] = [
  {
    id: "general",
    title: "Geral",
    items: [
      ["Abrir repositório", ["Ctrl", "O"]],
      ["Nova aba (dashboard)", ["Ctrl", "T"]],
      ["Fechar aba", ["Ctrl", "W"]],
      ["Próxima aba", ["Ctrl", "Tab"]],
      ["Configurações", ["Ctrl", ","]],
      ["Paleta de comandos", ["Ctrl", "K"]],
    ],
  },
  {
    id: "repo",
    title: "Repositório",
    items: [
      ["Atualizar", ["F5"]],
      ["Fetch", ["Ctrl", "Shift", "F"]],
      ["Pull", ["Ctrl", "Shift", "L"]],
      ["Push", ["Ctrl", "Shift", "P"]],
      ["Desfazer última ação do git", ["Ctrl", "Z"]],
      ["Terminal integrado", ["Ctrl", "`"]],
    ],
  },
  {
    id: "edit",
    title: "Commit e diff",
    items: [
      ["Fazer o commit", ["Ctrl", "Enter"]],
      ["Escolher um intervalo de linhas no diff", ["Shift", "Clique"]],
      ["Limpar a busca", ["Esc"]],
    ],
  },
];

export const PAGES: Page[] = [
  {
    id: "account",
    title: "Conta",
    icon: UserRound,
    group: "Geral",
    sections: [
      { id: "github", title: "GitHub" },
      { id: "security", title: "Segurança" },
    ],
    keywords: "login entrar sair token gh cli github",
    render: () => <AccountPage />,
  },
  {
    id: "identity",
    title: "Identidade",
    icon: UserRoundPen,
    group: "Geral",
    sections: [
      { id: "global", title: "Identidade global" },
      { id: "folders", title: "Por pasta" },
      { id: "signing", title: "Assinatura" },
    ],
    keywords: "nome email autor git config trabalho pessoal perfil includeif assinatura gpg ssh verificado",
    render: () => <IdentityPage />,
  },
  {
    id: "appearance",
    title: "Aparência",
    icon: Palette,
    group: "Experiência",
    sections: [
      { id: "theme", title: "Tema" },
      { id: "zoom", title: "Zoom" },
      { id: "history", title: "Histórico" },
    ],
    keywords: "tema escuro claro sistema cor zoom tamanho fonte texto neon avatar foto autor minimapa",
    render: (ctx) => <AppearancePage {...ctx} />,
  },
  {
    id: "git",
    title: "Git",
    icon: GitBranch,
    group: "Experiência",
    sections: [
      { id: "sync", title: "Sincronização" },
      { id: "pull", title: "Pull" },
      { id: "templates", title: "Modelos de branch" },
    ],
    keywords: "fetch automático intervalo minutos pull rebase merge fast-forward remote git-flow feature release hotfix prefixo",
    render: (ctx) => <GitPage {...ctx} />,
  },
  {
    id: "diff",
    title: "Diff",
    icon: GitCompareArrows,
    group: "Experiência",
    sections: [
      { id: "context", title: "Contexto" },
      { id: "layout", title: "Layout" },
      { id: "whitespace", title: "Espaços em branco" },
    ],
    keywords: "linhas contexto espaços branco whitespace comparação",
    render: (ctx) => <DiffPage {...ctx} />,
  },
  {
    id: "integrations",
    title: "Integrações",
    icon: Code2,
    group: "Experiência",
    sections: [
      { id: "editor", title: "Editor" },
      { id: "terminal", title: "Terminal" },
    ],
    keywords: "editor vscode code cursor zed terminal powershell cmd git bash windows terminal abrir",
    render: () => <IntegrationsPage />,
  },
  {
    id: "shortcuts",
    title: "Atalhos",
    icon: Keyboard,
    group: "Sistema",
    sections: SHORTCUTS.map((g) => ({ id: g.id, title: g.title })),
    keywords: "teclado atalho tecla ctrl shift keybind",
    render: () => <ShortcutsPage />,
  },
  {
    id: "about",
    title: "Sobre",
    icon: Info,
    group: "Sistema",
    sections: [
      { id: "version", title: "Versão" },
      { id: "reset", title: "Restaurar" },
    ],
    keywords: "versão tauri restaurar padrão resetar",
    render: () => <AboutPage />,
  },
];

const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => updateSettings({ [key]: value } as Partial<Settings>);

// ---------- Conta ----------

function AccountPage() {
  const [gh, reload] = useGithub();
  const [loginOpen, setLoginOpen] = useState(false);
  const profile = gh.kind === "ok" ? gh.profile : null;

  return (
    <>
      <Section id="github" title="GitHub" description="Usado no dashboard, na aba Pull Requests e nos links de issues.">
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-[0_0_40px_-16px_var(--glow)]">
          <div className="flex items-center gap-4">
            <Avatar name={profile?.name} url={profile?.avatarUrl} className="size-14 text-lg" />
            <div className="min-w-0 flex-1">
              {gh.kind === "loading" && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Conectando...
                </p>
              )}
              {profile && (
                <>
                  <p className="truncate font-semibold">{profile.name ?? profile.login}</p>
                  <button
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
                    onClick={() => openUrl(profile.url)}
                  >
                    <Github className="size-3.5" /> @{profile.login}
                  </button>
                  <Badge variant="outline" className="mt-1.5">
                    {profile.source === "gh" ? "via gh CLI" : "login do will-repo"}
                  </Badge>
                </>
              )}
              {gh.kind === "not_logged" && <p className="text-muted-foreground">Você não está conectado.</p>}
              {gh.kind === "offline" && <p className="text-muted-foreground">Sem internet.</p>}
              {gh.kind === "error" && <p className="text-sm text-destructive">{gh.message}</p>}
            </div>
            <div className="flex gap-2">
              {gh.kind === "not_logged" && (
                <Button size="sm" onClick={() => setLoginOpen(true)}>
                  <Github /> Entrar com GitHub
                </Button>
              )}
              {profile?.source === "app" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await git.githubLogout();
                    reload();
                  }}
                >
                  <LogOut /> Sair
                </Button>
              )}
              {(gh.kind === "offline" || gh.kind === "error") && (
                <Button size="sm" variant="outline" onClick={reload}>
                  <RefreshCw /> Tentar de novo
                </Button>
              )}
            </div>
          </div>
        </div>
        {profile?.source === "gh" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Conectado pelo login do gh CLI. Para sair, use <code>gh auth logout</code> no terminal.
          </p>
        )}
      </Section>

      <Section id="security" title="Segurança">
        <Row
          label="Onde fica o token"
          description="No Gerenciador de Credenciais do Windows, nunca em arquivo. Sem login no app, o token do gh CLI é usado."
        >
          <Badge variant="outline">Credential Manager</Badge>
        </Row>
        <Row label="Permissões pedidas" description="Ler o seu perfil e acessar repositórios (listar e criar pull requests).">
          <code className="text-xs text-muted-foreground">read:user repo</code>
        </Row>
      </Section>

      <GithubLogin
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onDone={() => {
          setLoginOpen(false);
          reload();
        }}
      />
    </>
  );
}

// ---------- Identidade ----------

function IdentityPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [list, setList] = useState<Identity[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    git.userInfo().then((u) => {
      setName(u.name ?? "");
      setEmail(u.email ?? "");
    });
    git.identities().then(setList, (e) => toast.error(String(e)));
  }, []);

  const saveGlobal = async () => {
    try {
      await git.setUserInfo(name, email);
      toast.success("Identidade global salva");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const saveFolders = async () => {
    if (!list) return;
    setSaving(true);
    try {
      await git.setIdentities(list.filter((i) => i.folder.trim()));
      setList(await git.identities());
      toast.success("Identidades por pasta salvas");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const edit = (i: number, patch: Partial<Identity>) =>
    setList((l) => l && l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const pick = async (i: number) => {
    const dir = await openDialog({ directory: true, title: "Pasta dos repositórios" });
    if (typeof dir === "string") edit(i, { folder: dir.replace(/\\/g, "/") });
  };

  return (
    <>
      <Section
        id="global"
        title="Identidade global"
        description={
          <>
            Nome e email gravados nos seus commits (<code>git config --global</code>).
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome" />
          <Input placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={saveGlobal}>
            <Check /> Salvar
          </Button>
        </div>
      </Section>

      <Section
        id="folders"
        title="Por pasta"
        description="Use outro nome e email em todos os repositórios dentro de uma pasta, como trabalho e pessoal. O próprio git aplica (includeIf), então vale também no terminal."
      >
        {!list ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <div className="flex flex-col gap-3">
            {list.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                Nenhuma identidade por pasta.
              </p>
            )}
            {list.map((id, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                <div className="flex gap-2">
                  <Input
                    className="font-mono text-xs"
                    placeholder="D:/Trabalho/"
                    value={id.folder}
                    onChange={(e) => edit(i, { folder: e.target.value })}
                    aria-label="Pasta"
                  />
                  <Button size="icon" variant="outline" aria-label="Escolher pasta" title="Escolher pasta" onClick={() => pick(i)}>
                    <FolderOpen />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    aria-label="Remover"
                    title="Remover"
                    onClick={() => setList((l) => l && l.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Nome" value={id.name} onChange={(e) => edit(i, { name: e.target.value })} aria-label="Nome" />
                  <Input placeholder="Email" value={id.email} onChange={(e) => edit(i, { email: e.target.value })} aria-label="Email" />
                </div>
              </div>
            ))}
            <div className="flex justify-between">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setList((l) => [...(l ?? []), { folder: "", name: "", email: "" }])}
              >
                <Plus /> Adicionar pasta
              </Button>
              <Button size="sm" disabled={saving} onClick={saveFolders}>
                {saving ? <Loader2 className="animate-spin" /> : <Check />} Salvar
              </Button>
            </div>
          </div>
        )}
      </Section>

      <SigningSection />
    </>
  );
}

/** Sign every commit with an SSH key (simplest) or GPG; history shows "Verificado" */
function SigningSection() {
  const [sig, setSig] = useState<Signing | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    // nothing configured yet: offer SSH, the simplest (git's own default would be GPG)
    git.signing(".").then((v) => setSig(!v.enabled && !v.key ? { ...v, format: "ssh" } : v), (e) => toast.error(String(e)));
    git.sshKeys().then(setKeys, () => {});
  }, []);
  if (!sig) return null;

  const save = async () => {
    try {
      await git.setSigning(sig);
      toast.success(sig.enabled ? "Commits serão assinados" : "Assinatura desligada");
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <Section
      id="signing"
      title="Assinatura"
      description="Assina cada commit com a sua chave. No GitHub e no histórico do app eles aparecem como verificados (no GitHub, cadastre a chave como “Signing key”)."
    >
      <Row label="Assinar commits e tags" htmlFor="sign-on">
        <Switch id="sign-on" checked={sig.enabled} onCheckedChange={(enabled) => setSig({ ...sig, enabled })} />
      </Row>
      {sig.enabled && (
        <>
          <Row label="Tipo de chave">
            <Select value={sig.format} onValueChange={(f) => setSig({ ...sig, format: f as Signing["format"], key: "" })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ssh">SSH</SelectItem>
                <SelectItem value="openpgp">GPG</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row
            label={sig.format === "ssh" ? "Chave pública" : "Id da chave GPG"}
            description={sig.format === "ssh" ? (keys.length ? "Arquivos .pub em ~/.ssh." : "Nenhuma chave em ~/.ssh. Crie com: ssh-keygen -t ed25519") : "Veja com: gpg --list-secret-keys --keyid-format=long"}
          >
            {sig.format === "ssh" && keys.length ? (
              <Select value={sig.key} onValueChange={(key) => setSig({ ...sig, key })}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Escolha a chave" />
                </SelectTrigger>
                <SelectContent>
                  {keys.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k.split("/").pop()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input className="w-64 font-mono text-xs" value={sig.key} onChange={(e) => setSig({ ...sig, key: e.target.value })} />
            )}
          </Row>
        </>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={sig.enabled && !sig.key.trim()} onClick={save}>
          <Check /> Salvar
        </Button>
      </div>
    </Section>
  );
}

// ---------- Aparência ----------

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun; swatch: string }[] = [
  { value: "system", label: "Sistema", icon: Monitor, swatch: "bg-[linear-gradient(135deg,#f5f3ff_50%,#0b0a12_50%)]" },
  { value: "dark", label: "Escuro", icon: Moon, swatch: "bg-[#0b0a12]" },
  { value: "light", label: "Claro", icon: Sun, swatch: "bg-[#f5f3ff]" },
];

function AppearancePage({ theme, setTheme, goTo }: SettingsContext) {
  const s = useSettings();
  return (
    <>
      <Preview />
      <Section id="theme" title="Tema">
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const active = t.value === theme;
            return (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={cn(
                  "group relative flex flex-col gap-2 rounded-xl border bg-card p-2 text-left transition-shadow hover:border-primary/50",
                  active && "border-primary shadow-[0_0_22px_-4px_var(--glow)]",
                )}
              >
                <span className={cn("h-16 rounded-lg border", t.swatch)} />
                <span className="flex items-center gap-1.5 px-1 text-sm font-medium">
                  <t.icon className="size-3.5" /> {t.label}
                </span>
                {active && (
                  <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">"Sistema" acompanha o tema do Windows quando ele muda.</p>
      </Section>

      <Section id="zoom" title="Zoom" description="Tamanho de toda a interface: texto, ícones e grafo.">
        <StopSlider
          value={s.zoom}
          stops={[0.8, 0.9, 1, 1.1, 1.25, 1.5]}
          format={(n) => `${Math.round(n * 100)}%`}
          onChange={set("zoom")}
        />
      </Section>

      <Section id="history" title="Histórico">
        <Row
          label="Fotos dos autores"
          description="Ao lado do nome, no histórico. Vem do GitHub ou do Gravatar (só o hash do email é enviado)."
          htmlFor="show-avatars"
        >
          <Switch id="show-avatars" checked={s.showAvatars} onCheckedChange={set("showAvatars")} />
        </Row>
        <Related
          icon={Keyboard}
          title="Atalhos"
          description="Veja todos os atalhos de teclado do app"
          onClick={() => goTo("shortcuts")}
        />
      </Section>
    </>
  );
}

/** Mini history + diff in the app's colors, so theme and zoom changes show right away */
function Preview() {
  const rows = [
    { lane: 1, msg: "feat: configurações no estilo Discord", ref: "master", author: "você" },
    { lane: 2, msg: "fix: fetch automático sem janela de login", author: "você" },
    { lane: 1, msg: "docs: lista de a fazeres", author: "você" },
  ];
  return (
    <div className="mb-8">
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">Prévia</p>
      <div className="overflow-hidden rounded-xl border bg-card shadow-[0_0_40px_-18px_var(--glow)]">
        {rows.map((r, i) => (
          <div key={i} className={cn("flex h-7 items-center gap-3 px-3 text-sm", i === 0 && "bg-accent shadow-[inset_2px_0_0_var(--primary)]")}>
            <span className="size-2.5 rounded-full" style={{ background: `var(--lane-${r.lane})`, boxShadow: `0 0 8px var(--lane-${r.lane})` }} />
            {r.ref && <Badge className="h-4 px-1.5 font-mono text-[10px]">{r.ref}</Badge>}
            <span className="flex-1 truncate">{r.msg}</span>
            <span className="text-xs text-muted-foreground">{r.author}</span>
          </div>
        ))}
        <div className="border-t font-mono text-xs">
          <div className="bg-diff-del px-3 py-0.5 text-destructive">- const intervalo = 5;</div>
          <div className="bg-diff-add px-3 py-0.5 text-success">+ const intervalo = settings.autoFetchMinutes;</div>
        </div>
      </div>
    </div>
  );
}

// ---------- Git ----------

const FETCH_OPTIONS = [0, 1, 5, 10, 15, 30];

const PULL_MODES: { value: Settings["pullMode"]; title: string; description: string }[] = [
  { value: "ff-only", title: "Só avançar (recomendado)", description: "Falha se as branches divergirem. Nunca cria commit de merge sem você ver." },
  { value: "rebase", title: "Rebase", description: "Reaplica seus commits locais em cima dos commits do remote. Histórico linear." },
  { value: "merge", title: "Merge", description: "Cria um commit de merge quando as branches divergirem." },
];

function GitPage({ goTo }: SettingsContext) {
  const s = useSettings();
  return (
    <>
      <Section id="sync" title="Sincronização">
        <Row
          label="Fetch automático"
          description="Busca commits novos do remote em segundo plano e avisa quando a sua branch ficar para trás."
        >
          <Select value={String(s.autoFetchMinutes)} onValueChange={(v) => set("autoFetchMinutes")(Number(v))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FETCH_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m === 0 ? "Desligado" : m === 1 ? "A cada minuto" : `A cada ${m} min`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section id="pull" title="Pull" description="O que o botão Pull faz quando há commits locais e remotos ao mesmo tempo.">
        <div className="flex flex-col gap-2" role="radiogroup">
          {PULL_MODES.map((m) => {
            const active = s.pullMode === m.value;
            return (
              <button
                key={m.value}
                role="radio"
                aria-checked={active}
                onClick={() => set("pullMode")(m.value)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-shadow hover:border-primary/50",
                  active && "border-primary shadow-[0_0_20px_-6px_var(--glow)]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2",
                    active ? "border-primary" : "border-muted-foreground/50",
                  )}
                >
                  {active && <span className="size-1.5 rounded-full bg-primary" />}
                </span>
                <span>
                  <span className="block text-sm font-medium">{m.title}</span>
                  <span className="block text-xs text-muted-foreground">{m.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        id="templates"
        title="Modelos de branch"
        description="Prefixos oferecidos ao criar uma branch. “Finalizar” (menu da branch) mescla na base com um commit de merge, cria a tag se marcado e exclui a branch."
      >
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1fr_1fr_70px_32px] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] tracking-wider text-muted-foreground uppercase">
            <span>Prefixo</span>
            <span>Base</span>
            <span>Tag</span>
            <span />
          </div>
          {s.branchTemplates.map((t, i) => {
            const change = (patch: Partial<typeof t>) =>
              set("branchTemplates")(s.branchTemplates.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_70px_32px] items-center gap-2 border-b px-3 py-1.5 last:border-0">
                <Input className="h-7 font-mono text-xs" value={t.prefix} onChange={(e) => change({ prefix: e.target.value.replace(/\s/g, "-") })} aria-label="Prefixo" />
                <Input className="h-7 font-mono text-xs" placeholder="main/master" value={t.base} onChange={(e) => change({ base: e.target.value.trim() })} aria-label="Base" />
                <Switch checked={t.tag} onCheckedChange={(v) => change({ tag: v })} aria-label="Criar tag ao finalizar" />
                <Button size="icon-xs" variant="ghost" className="text-destructive" aria-label="Remover" onClick={() => set("branchTemplates")(s.branchTemplates.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-2">
          <Button size="sm" variant="outline" onClick={() => set("branchTemplates")([...s.branchTemplates, { prefix: "", base: "", tag: false }])}>
            <Plus /> Adicionar modelo
          </Button>
        </div>
        <div className="mt-4">
          <Related
            icon={Code2}
            title="Integrações"
            description="Editor e terminal usados pelos botões do repositório"
            onClick={() => goTo("integrations")}
          />
        </div>
      </Section>
    </>
  );
}

// ---------- Diff ----------

function DiffPage({ goTo }: SettingsContext) {
  const s = useSettings();
  // sample change in the middle of a file, cut to the chosen context
  const before = ["fn main() {", "    let repo = abrir();", "    let log = repo.log();", "    mostrar(log);", "    salvar(repo);", "}"];
  const ctx = Math.min(s.diffContext, 3);
  return (
    <>
      <Section id="context" title="Contexto" description="Linhas sem alteração mostradas antes e depois de cada trecho.">
        <StopSlider value={s.diffContext} stops={[1, 2, 3, 5, 8, 10]} format={(n) => `${n}`} onChange={set("diffContext")} />
        <div className="overflow-hidden rounded-lg border bg-card font-mono text-xs whitespace-pre">
          <div className="bg-muted/60 px-3 py-0.5 text-muted-foreground">@@ -1,{ctx * 2 + 1} +1,{ctx * 2 + 1} @@</div>
          {before.slice(3 - ctx, 3).map((l) => (
            <div key={l} className="px-3 py-0.5 text-muted-foreground">
              {"  "}
              {l}
            </div>
          ))}
          <div className="bg-diff-del px-3 py-0.5 text-destructive">- {before[3]}</div>
          <div className="bg-diff-add px-3 py-0.5 text-success">+     mostrar(log.filtrar());</div>
          {before.slice(4, 4 + ctx).map((l) => (
            <div key={l} className="px-3 py-0.5 text-muted-foreground">
              {"  "}
              {l}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Vale para todos os diffs. Muda ao abrir o próximo arquivo.</p>
      </Section>

      <Section id="layout" title="Layout">
        <Row label="Mostrar o diff" description="Também dá para trocar pelo botão no topo de cada diff.">
          <Select value={s.diffLayout} onValueChange={(v) => set("diffLayout")(v as Settings["diffLayout"])}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unified">Unificado</SelectItem>
              <SelectItem value="split">Lado a lado</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section id="whitespace" title="Espaços em branco">
        <Row
          label="Ignorar mudanças só de espaço"
          description="No histórico e nos stashes. As alterações locais sempre mostram tudo, para preparar trechos corretamente."
          htmlFor="ignore-ws"
        >
          <Switch id="ignore-ws" checked={s.ignoreWhitespace} onCheckedChange={set("ignoreWhitespace")} />
        </Row>
        <div className="mt-4">
          <Related icon={Palette} title="Aparência" description="Tema e zoom da interface" onClick={() => goTo("appearance")} />
        </div>
      </Section>
    </>
  );
}

// ---------- Integrações ----------

const EDITORS = [
  { value: "", label: "Aplicativo padrão" },
  { value: "code", label: "Visual Studio Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
  { value: "subl", label: "Sublime Text" },
  { value: "notepad++", label: "Notepad++" },
];

const TERMINALS: { value: Settings["terminal"]; label: string }[] = [
  { value: "wt", label: "Windows Terminal" },
  { value: "pwsh", label: "PowerShell 7" },
  { value: "powershell", label: "Windows PowerShell" },
  { value: "cmd", label: "Prompt de Comando" },
  { value: "git-bash", label: "Git Bash" },
];

function IntegrationsPage() {
  const s = useSettings();
  const [custom, setCustom] = useState(() => !EDITORS.some((e) => e.value === s.editor));
  return (
    <>
      <Section id="editor" title="Editor" description="Usado em “Abrir no editor” (arquivos com conflito e o botão Editor do repositório).">
        <Row label="Editor" description="O comando precisa estar no PATH.">
          {/* Radix Select doesn't accept "" as a value: "default" stands for it */}
          <Select
            value={custom ? "custom" : s.editor || "default"}
            onValueChange={(v) => {
              setCustom(v === "custom");
              if (v !== "custom") set("editor")(v === "default" ? "" : v);
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITORS.map((e) => (
                <SelectItem key={e.value || "default"} value={e.value || "default"}>
                  {e.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Outro comando...</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        {custom && (
          <Row label="Comando" description="Nome ou caminho completo do programa. Vazio = aplicativo padrão.">
            <Input
              className="w-56 font-mono text-xs"
              placeholder="idea64"
              value={s.editor}
              onChange={(e) => set("editor")(e.target.value)}
            />
          </Row>
        )}
      </Section>

      <Section id="terminal" title="Terminal" description="Shell do terminal integrado (Ctrl+`) e programa do terminal externo (paleta). O Windows Terminal não roda dentro do app: no integrado ele usa o PowerShell.">
        <Row label="Terminal">
          <Select value={s.terminal} onValueChange={(v) => set("terminal")(v as Settings["terminal"])}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINALS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>
    </>
  );
}

// ---------- Atalhos ----------

function ShortcutsPage() {
  return (
    <>
      {SHORTCUTS.map((g) => (
        <Section key={g.id} id={g.id} title={g.title}>
          <div className="overflow-hidden rounded-lg border">
            {g.items.map(([label, keys]) => (
              <div key={label} className="flex items-center justify-between border-b bg-card px-4 py-2.5 text-sm last:border-0">
                {label}
                <span className="flex gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

// ---------- Sobre ----------

function AboutPage() {
  const [versions, setVersions] = useState<[string, string]>(["", ""]);
  useEffect(() => {
    Promise.all([getVersion(), getTauriVersion()]).then(setVersions, () => {});
  }, []);

  const reset = async () => {
    const ok = await ask("Voltar todas as preferências do app ao padrão? Identidades e login do GitHub não mudam.", {
      title: "Restaurar padrões",
      kind: "warning",
      okLabel: "Restaurar",
      cancelLabel: "Cancelar",
    });
    if (!ok) return;
    updateSettings(DEFAULTS);
    toast.success("Preferências restauradas");
  };

  return (
    <>
      <Section id="version" title="Versão">
        <div className="flex items-center gap-4 rounded-xl border bg-card p-5 shadow-[0_0_40px_-16px_var(--glow)]">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_20px_var(--glow)]">
            <GitBranch className="size-6" />
          </span>
          <div className="flex-1">
            <p className="font-semibold">will-repo</p>
            <p className="font-mono text-xs text-muted-foreground">
              v{versions[0]} · Tauri {versions[1]}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => openUrl("https://github.com/WiliamMP/will-repo")}>
            <Github /> Repositório
          </Button>
        </div>
      </Section>
      <Section id="reset" title="Restaurar">
        <Row label="Preferências padrão" description="Zoom, fetch, pull, diff, editor e terminal voltam ao original.">
          <Button size="sm" variant="outline" onClick={reset}>
            <RotateCcw /> Restaurar padrões
          </Button>
        </Row>
      </Section>
    </>
  );
}
