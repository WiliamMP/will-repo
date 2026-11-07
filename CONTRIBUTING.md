# Contribuindo com o will-repo

Valeu pelo interesse! Bug, ideia ou código: toda ajuda conta.

## Antes de começar

- **Bug:** abra uma [issue de bug](https://github.com/WiliamMP/will-repo/issues/new?template=bug.yml) com a versão do app, do Windows e do git, e os passos para reproduzir.
- **Ideia ou recurso novo:** abra uma [issue de sugestão](https://github.com/WiliamMP/will-repo/issues/new?template=feature.yml) antes de escrever código. Assim a gente combina o caminho e ninguém perde tempo.
- Procurando por onde começar? Veja as issues com [`good first issue`](https://github.com/WiliamMP/will-repo/labels/good%20first%20issue) e o backlog em [`docs/todo`](docs/todo/README.md).
- **Falha de segurança:** não abra issue pública, veja [SECURITY.md](SECURITY.md).

## Rodando localmente

Requisitos: Windows, [Node 22](https://nodejs.org), [Rust](https://rustup.rs) e [git](https://git-scm.com).

```bash
npm ci
npm run tauri dev      # app com recarga automática
```

Estrutura:

| Pasta | O que tem |
|---|---|
| `src-tauri/src/git.rs` | comandos Tauri de git (rodam o git CLI) |
| `src-tauri/src/parse.rs` | parsing puro da saída do git |
| `src-tauri/src/github.rs` | integração com o GitHub |
| `src-tauri/src/lib.rs` | registro dos comandos (**comando novo entra aqui**) |
| `src/lib/git.ts` | wrappers tipados de `invoke` para cada comando Rust |
| `src/components/` | telas; `ui/` são componentes shadcn |

## Testes

Rode antes de abrir o PR (o CI roda os mesmos):

```bash
cd src-tauri && cargo test   # backend, com repositórios git reais em pastas temporárias
npm test                     # interface (Vitest + Testing Library)
npx tsc --noEmit -p .        # typecheck
npm run e2e                  # ponta a ponta: o app de verdade (mais lento)
```

Mudou comportamento? Acrescente ou ajuste um teste que pegaria a regressão.

## Convenções

- **Interface em português**; código, nomes e comentários em **inglês**.
- Ícones só do [lucide](https://lucide.dev), nunca emoji. Cores e brilho pelos tokens do tema Neon em `src/index.css`.
- Ações destrutivas: prefira "dá para desfazer" (backup, Ctrl+Z, máquina do tempo) a pedir confirmação.
- Comentários explicam o **porquê**, curtos.
- `cargo fmt` no Rust.

## Commits e pull requests

Commits no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português:

```
feat: arrastar projetos para grupos no dashboard
fix(security): Content Security Policy no WebView
```

Tipos usados: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `ci`, `chore`.

No PR:

1. Um assunto por PR. PR pequeno é revisado mais rápido.
2. Descreva o que mudou e por quê; se mexeu na interface, coloque um print ou GIF.
3. Confira que o CI passou.

Ao contribuir, você concorda que seu código é publicado sob a [licença GPL-3.0](LICENSE) do projeto.
