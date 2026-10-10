---
description: Lança uma versão nova do will-repo (sobe a versão, testa, cria a tag e acompanha o Release)
argument-hint: <versão, ex. 0.2.1>
---

Lance a versão **$ARGUMENTS** do will-repo. Se não veio versão, sugira a próxima patch a partir do `package.json` e pergunte antes de seguir.

1. Confira que a árvore está limpa (`git status`) e atualizada com `origin/master`. Se não estiver, pare e explique.
2. Suba a versão para `$ARGUMENTS` em **três lugares**: `package.json`, `src-tauri/Cargo.toml` (`version = ...` do pacote) e `src-tauri/tauri.conf.json`. Rode `cargo check` em `src-tauri` para atualizar o `Cargo.lock`.
3. Rode os testes: `cargo test` (em `src-tauri`), `npm test` e `npx tsc --noEmit -p .`. Se algo falhar, pare e mostre.
4. Mostre o resumo do que entrou desde a última tag (`git log <última tag>..HEAD --oneline`) e **peça confirmação** antes de publicar.
5. Commit `chore: versão $ARGUMENTS`, push, depois `git tag v$ARGUMENTS && git push origin v$ARGUMENTS`.
6. Acompanhe o workflow *Release* (`gh run watch`). No fim, confira no Release o `-setup.exe`, o `.msi`, os `.sig` e o `latest.json` apontando para `$ARGUMENTS`.
7. Responda com o link do Release e lembre que o app instalado vai oferecer a atualização sozinho.
