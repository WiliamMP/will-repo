# A fazer

Lista de próximas funcionalidades do will-repo. Tamanho estimado entre parênteses.
⭐ = prioridade sugerida.

## Dia a dia no git

- [ ] **Rebase interativo**: reordenar, squash, editar mensagem e descartar commits arrastando na lista. (grande)

## Integração com GitHub


## Conforto


## Distribuição


## Design system


## Ideias das referências, com o toque do will-repo

Recursos inspirados no Sourcetree, no GitKraken e no Fork, repensados para o estilo do app
(teclado primeiro, tema Neon, dashboard central). Entre colchetes, de onde veio a ideia.

### Segurança e "desfazer"


### Grafo e histórico


### Diff e conflitos

- [ ] **Editor de conflito em 3 colunas** [Fork/GitKraken]: atual, recebida e resultado editável lado a lado, escolhendo linha por linha. Evolução da resolução por bloco que já existe. (grande)

### Commits


### Fluxos e estrutura


### Dashboard e GitHub

- [ ] **Central de pendências** [Launchpad do GitKraken + notificações do Fork]: no dashboard, PRs aguardando sua revisão, seus PRs abertos com status do CI e notificações do GitHub, de todos os projetos. (grande)

## Já feito

- [x] MVP: abrir repositório, histórico com grafo, detalhes e diff, stage/unstage/descartar, commit, fetch/pull/push, checkout, criar branch, tema claro/escuro/sistema
- [x] Stash; stage, unstage e descarte por trecho e por linha
- [x] Merge e rebase pela interface, resolução de conflitos, excluir branch
- [x] Busca de commits, histórico paginado e virtualizado, abas com vários repositórios
- [x] Dashboard com perfil, contribuições e cards de projetos
- [x] Login no GitHub (gh CLI / Device Flow) com volta para os dados locais quando offline
- [x] Amend, cherry-pick e revert pelo menu do commit, tags (criar, excluir, enviar)
- [x] Pull Requests: lista dos abertos com CI e revisão, criar PR da branch atual (com push automático)
- [x] Descartar sem medo: backup antes de cada descarte, "Desfazer" no aviso e lista de descartes recentes
- [x] Assistente de mensagem: chips de Conventional Commits, mensagens recentes e contador do título
- [x] Links de issues: #123 no título e no corpo do commit abre no GitHub; detalhes mostram o corpo da mensagem
- [x] Fetch automático a cada 5 minutos, com aviso e botão de Pull quando chegam commits novos
- [x] Tela de configurações no estilo do Discord: conta, identidade (global e por pasta), aparência (tema, zoom), git (fetch automático, modo do pull), diff (contexto, espaços), integrações (editor, terminal), atalhos e sobre
- [x] Splash screen enquanto o app carrega; ícone próprio (fonte em `src-tauri/icons/icon.svg`, gere os tamanhos com `npx tauri icon`); instaladores com `npm run tauri build` (NSIS em português e MSI em `src-tauri/target/release/bundle/`)
- [x] Paleta de comandos (Ctrl+K): abas, recentes, tema, configurações, fetch/pull/push, branches, painéis e operações
- [x] Grafo: avatares dos autores, stashes como nós, modo foco (isolar/esconder branches) com destaque do caminho do HEAD, minimapa
- [x] Diff: virtualizado (só as linhas visíveis), modo lado a lado com seleção de linhas, diff de imagens (lado a lado, deslizar, sobrepor)
- [x] Navegador de arquivos em qualquer commit (árvore, conteúdo, imagens), blame e histórico do arquivo
- [x] Máquina do tempo (reflog) com branch/checkout/voltar para cá, e Ctrl+Z para commit, amend, checkout, merge, pull, reset, rebase e branch excluída
- [x] Arrastar e soltar branches (grafo e sidebar) com menu mesclar/rebase/cherry-pick; modelos de branch (feature/, fix/, release/, hotfix/) com base e "Finalizar"
- [x] Submódulos (estado, baixar/atualizar, abrir em nova aba), worktrees (criar, abrir em aba, remover) e Git LFS (padrões e arquivos)
- [x] Terminal integrado (Ctrl+`): shell real em PTY com xterm.js, várias abas, tema Neon
- [x] Clonar repositório (lista dos seus repos do GitHub ou URL) e grupos de projetos no dashboard com "Fetch em todos"
- [x] CI no GitHub Actions (typecheck, build, cargo test no Windows); mensagem de commit sugerida pelo Claude (Claude Code CLI, sem chave de API)
- [x] Assinatura de commits (SSH ou GPG) com selo "Verificado"; compartilhar alterações como Gist secreto
- [x] Registry shadcn "Neon" gerado do próprio tema (`npm run registry`): tema claro/escuro, cores extras e componentes Magic UI; testado instalando num projeto Vite novo
- [x] Device Flow ativado (OAuth App "will-repo"); login pelo app também quando o gh CLI já está conectado
- [x] Registry Neon publicado no GitHub Pages: `npx shadcn add https://wiliammp.github.io/will-repo/r/neon.json` (atualiza sozinho a cada push no tema)
- [x] Auto-update pelos Releases do GitHub (instaladores assinados); release com `git tag vX.Y.Z && git push origin vX.Y.Z`
- [x] Testes automatizados da interface com Vitest + Testing Library (`npm test`), também no CI
- [x] Testes ponta a ponta (`npm run e2e`): o app real com git real, via WebdriverIO + msedgedriver no WebView2; também no CI
- [x] Dependabot: atualizações semanais agrupadas (npm, cargo, GitHub Actions), cada PR testado pelo CI
