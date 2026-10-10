# will-repo

Cliente git para Windows (estilo Sourcetree/GitKraken/Fork), tema **Neon**. Tauri 2 + Rust no backend, React 19 + TypeScript + shadcn/ui na interface. Repositório público, licença MIT.

O dono vem do **Delphi** e está aprendendo Rust e React com este projeto: ao explicar código novo, dê uma analogia curta com Delphi/Pascal (ex.: `Result<T, E>` ≈ função que retorna valor ou levanta exceção; `invoke()` ≈ chamar função de uma DLL; hook React ≈ TDataModule/TActionList). Responda em **português**.

## Arquitetura

- `src-tauri/src/git.rs`: todos os comandos Tauri de git. Cada um roda o **git CLI** (`git()` / `run()` / `command()`), com `#[tauri::command(async)]`. Testes no fim do arquivo criam repositórios reais em pastas temporárias (`temp_repo`).
- `src-tauri/src/parse.rs`: parsing puro da saída do git (log, refs, status, diff, conflitos, blame, lanes do grafo). Testes unitários.
- `src-tauri/src/github.rs`: GitHub (Device Flow, token no Credential Manager via `keyring`, perfil, PRs, repos, Gist). Token do app tem prioridade sobre o do `gh`.
- `src-tauri/src/pty.rs`: terminal integrado (portable-pty/ConPTY).
- `src-tauri/src/lib.rs`: registro de plugins e comandos (`generate_handler!`). **Comando novo precisa entrar aqui.**
- `src/lib/git.ts`: wrappers tipados de `invoke` para cada comando Rust. Opções que vêm das configurações (contexto do diff, modo do pull...) são lidas aqui via `getSettings()`, não passadas pelos componentes.
- `src/hooks/use-repo.ts` (estado de um repositório aberto), `use-settings.ts` (preferências em localStorage), `use-theme.ts`.
- `src/components/`: telas. `RepoView` monta um repositório (sidebar, histórico, painel direito). `ui/` são componentes shadcn e Magic UI.
- `src/lib/commands.ts`: registro da paleta (Ctrl+K). Telas registram comandos com `useCommands`.

## Convenções

- Interface em **português**; código, nomes e comentários em **inglês**.
- Ícones só do **lucide-react** (nunca emoji). Visual: tokens Neon do `src/index.css` (roxo `#7c5cff`, brilho `--glow`), fontes Geist. Magic UI com moderação.
- Comentários explicam o porquê, curtos. Atalhos deliberados levam um comentário `ponytail:` com o limite e o caminho de melhoria.
- Ações destrutivas na interface: preferir "dá para desfazer" (backup, Ctrl+Z, máquina do tempo) a pedir confirmação.
- Commits em Conventional Commits, em português.

## Testes (rodar antes de commitar)

```bash
cd src-tauri && cargo test   # 50 testes, git real
npm test                     # Vitest + Testing Library (interface, Tauri simulado)
npm run e2e                  # ponta a ponta: app real via WebdriverIO (build + testes)
npx tsc --noEmit -p .        # typecheck
```

Teste visual: `npm run tauri dev` e conferir a tela. Os três rodam no CI (`.github/workflows/ci.yml`).

## Armadilhas já conhecidas

- **e2e**: o Tauri ignora `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`; por isso `e2e/build.mjs` gera um build com identificador `.e2e` e porta de depuração 9222, e o WebdriverIO se conecta com `debuggerAddress` e protocolo clássico (`wdio:enforceWebDriverClassic`). Fique no **WebdriverIO 9** (a 10 quebra o `npm install`).
- `dragDropEnabled: false` na janela principal é necessário para o arrastar e soltar HTML (branches) funcionar no Windows.
- Identidade por pasta (`includeIf`): o caminho precisa ser o real (`canonicalize`), senão nomes curtos tipo `RUNNER~1` quebram.
- O updater instala em modo de atualização e **não cria atalhos**; quem instala pelo setup ganha os atalhos.
- `serialize-javascript` está em `overrides` no `package.json` (correção de segurança).

## Versão e release

Versão em três lugares: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. Depois `git tag vX.Y.Z && git push origin vX.Y.Z`: o workflow *Release* compila, assina (segredos `TAURI_SIGNING_PRIVATE_KEY*`) e publica; o app instalado se atualiza pelo `latest.json`. A chave privada **nunca** vai para o repositório. Use `/release`.

## Outros

- Backlog em `docs/todo/README.md` (marque `[x]` ao terminar um item).
- Registry shadcn "Neon" publicado no GitHub Pages pelo workflow *Registry* (`npm run registry` gera localmente).
- `master` protegida contra push forçado e exclusão (push direto liberado).
