# Changelog

Mudanças de cada versão. Formato baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões seguem o [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.4.0] - 2026-11-06

### Adicionado
- Aviso na tela Sobre e no README: o will-repo é gratuito e só é baixado oficialmente pelos Releases do GitHub.

### Alterado
- Licença trocada de MIT para GPL-3.0: forks continuam livres, mas precisam manter o código aberto.
- Dependências atualizadas (Tauri 2.12, TypeScript 7, reqwest 0.13 e outras).

## [0.3.1] - 2026-10-24

### Adicionado
- Abrir a pasta do repositório e abrir no GitHub pela aba e pela tela do repositório.
- Arrastar projetos para grupos no dashboard.

### Alterado
- Menu de contexto nativo do WebView escondido.

## [0.3.0] - 2026-10-10

### Adicionado
- Animações por toda a interface.

### Corrigido
- Content Security Policy no WebView.
- Aviso de atualização com texto próprio em vez das notas do release.
- Correção de segurança no `serialize-javascript`.

### Interno
- Testes da interface (Vitest + Testing Library) e ponta a ponta com o app de verdade.
- Dependabot com atualizações semanais agrupadas.

## [0.2.0] - 2026-10-09

Primeira versão pública.

### Adicionado
- Grafo de commits com avatares, stashes, modo foco e minimapa.
- Stage por trecho e por linha, stash, merge e rebase com resolução de conflitos, busca e abas.
- Descartar sem medo, com backup; máquina do tempo e Ctrl+Z para ações do git.
- Diff virtualizado, lado a lado e de imagens.
- Navegador de arquivos com blame e histórico.
- Amend, cherry-pick, revert e tags; assinatura de commits.
- Arrastar branches para mesclar, rebase ou cherry-pick; modelos de branch.
- Submódulos, worktrees e Git LFS; terminal integrado (Ctrl+`).
- GitHub: login pelo app, pull requests, clonar, perfil e contribuições no dashboard, compartilhar alterações por Gist.
- Assistente de mensagem de commit e mensagem sugerida pelo Claude.
- Paleta de comandos (Ctrl+K), configurações (Ctrl+,), fetch automático, links de issues.
- Instalador Windows e atualização automática pelos Releases.

[Não lançado]: https://github.com/WiliamMP/will-repo/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/WiliamMP/will-repo/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/WiliamMP/will-repo/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/WiliamMP/will-repo/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/WiliamMP/will-repo/releases/tag/v0.2.0
