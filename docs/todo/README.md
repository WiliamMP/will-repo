# A fazer

Lista de próximas funcionalidades do will-repo. Tamanho estimado entre parênteses.
⭐ = prioridade sugerida.

## Dia a dia no git

- [ ] **Rebase interativo**: reordenar, squash, editar mensagem e descartar commits arrastando na lista. (grande)
- [ ] **Histórico e blame de um arquivo**: quem mudou cada linha e quando. (médio)
- [ ] **Diff lado a lado**, além do diff unificado atual. (médio)

## Integração com GitHub

- [ ] **Clonar repositório** a partir da lista dos seus repos no GitHub. (pequeno)
- [ ] **Ativar o Device Flow**: criar o OAuth App em github.com/settings/developers (com "Enable Device Flow") e colar o Client ID em `CLIENT_ID` no arquivo `src-tauri/src/github.rs`. (trivial)

## Conforto

- [ ] **Fetch automático** a cada X minutos, com aviso quando houver commits novos no remote. (pequeno)
- [ ] **Tela de configurações**: tema, intervalo do fetch, editor externo, nome e email do git. (médio)
- [ ] **Paleta de comandos (Ctrl+K)** para executar qualquer ação pelo teclado. (médio)
- [ ] **Virtualizar o diff** para arquivos muito grandes (hoje marcado com `ponytail:` em `DiffView.tsx`). (pequeno)

## Distribuição

- [ ] **Instalador Windows** (`.msi` / `.exe` via `tauri build`) com ícone próprio. (pequeno)
- [ ] **Auto-update** via GitHub Releases. (médio)
- [ ] **CI no GitHub Actions** rodando `cargo test`, typecheck e build. (médio)

## Design system

- [ ] **Registry shadcn com o tema Neon**, para reutilizar o mesmo estilo nos outros apps (`npx shadcn add <url>`). (médio)

## Ideias das referências, com o toque do will-repo

Recursos inspirados no Sourcetree, no GitKraken e no Fork, repensados para o estilo do app
(teclado primeiro, tema Neon, dashboard central). Entre colchetes, de onde veio a ideia.

### Segurança e "desfazer"

- [ ] **Máquina do tempo** [reflog do Fork]: linha do tempo de todos os movimentos do HEAD (commits, checkouts, resets, rebases) com restauração em um clique. Recupera commits "perdidos". (médio)
- [ ] **Ctrl+Z para ações do git** [undo/redo do GitKraken]: desfazer o último commit, checkout, merge ou branch excluída. (médio)

### Grafo e histórico

- [ ] **Arrastar e soltar no grafo** [GitKraken]: arrastar uma branch sobre outra abre "Mesclar / Rebase / Cherry-pick". (médio)
- [ ] **Modo foco** [hide/solo do GitKraken]: esconder branches ou isolar uma só no grafo, com destaque neon no caminho do HEAD. (médio)
- [ ] **Avatares nos commits** [GitKraken]: foto do autor (GitHub/Gravatar) no nó do grafo ou ao lado do autor. (pequeno)
- [ ] **Navegar pelos arquivos em qualquer commit** [Fork]: árvore de pastas daquele ponto do histórico, com visualização do conteúdo. (médio)
- [ ] **Stashes no grafo** [Fork]: stashes como nós especiais no histórico, presos ao commit de origem. (pequeno)
- [ ] **Minimapa do grafo** [GitKraken]: barra lateral com a densidade de commits e marcadores de branches e tags para pular rápido. (médio)

### Diff e conflitos

- [ ] **Diff de imagens** [Fork]: comparação com slider (antes/depois) e modo sobreposição para PNG/JPG/SVG. (médio)
- [ ] **Editor de conflito em 3 colunas** [Fork/GitKraken]: atual, recebida e resultado editável lado a lado, escolhendo linha por linha. Evolução da resolução por bloco que já existe. (grande)

### Commits

- [ ] **Mensagem de commit sugerida por IA** [GitKraken]: gerar a mensagem a partir do diff preparado, com Claude. (médio)
- [ ] **Identidade por pasta** [perfis do GitKraken]: usar nome e email de trabalho ou pessoal automaticamente conforme a pasta do repositório. (pequeno)
- [ ] **Assinatura GPG/SSH** [Fork]: assinar commits e mostrar o selo "verificado" no histórico. (médio)

### Fluxos e estrutura

- [ ] **Modelos de branch** [Git-flow do Sourcetree e do Fork]: prefixos configuráveis (feature/, fix/, release/) com assistente para iniciar e finalizar, sem impor o git-flow inteiro. (médio)
- [ ] **Submódulos** [Sourcetree/Fork]: listar, atualizar e abrir o submódulo em nova aba. (médio)
- [ ] **Git LFS** [Sourcetree/Fork]: mostrar arquivos LFS, rastrear e destrastrear extensões. (médio)
- [ ] **Worktrees**: abrir outra branch em pasta paralela, cada uma na sua aba. (médio)
- [ ] **Terminal integrado** [GitKraken]: painel de terminal na pasta do repositório (Ctrl+`). (médio)

### Dashboard e GitHub

- [ ] **Grupos de projetos** [workspaces do GitKraken]: agrupar repos no dashboard (Trabalho, Pessoal...) e fazer fetch em todos de uma vez. (médio)
- [ ] **Central de pendências** [Launchpad do GitKraken + notificações do Fork]: no dashboard, PRs aguardando sua revisão, seus PRs abertos com status do CI e notificações do GitHub, de todos os projetos. (grande)
- [ ] **Compartilhar um diff** [Cloud Patches do GitKraken]: enviar alterações ainda não commitadas como Gist privado, para mostrar a alguém. (médio)

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
