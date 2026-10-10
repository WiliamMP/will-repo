---
description: Roda todas as baterias de teste do will-repo e resume o resultado
argument-hint: "[rapido] para pular o ponta a ponta"
---

Rode os testes do will-repo e responda com um resumo curto: quantos passaram em cada bateria e, se algo falhou, o nome do teste e a mensagem de erro principal (sem despejar o log inteiro).

1. `npx tsc --noEmit -p .` (typecheck)
2. `cargo test` dentro de `src-tauri` (backend, git real)
3. `npm test` (interface, Vitest)
4. `npm run e2e` (ponta a ponta, o app real) — **pule** se o argumento for `rapido`: "$ARGUMENTS"

Se algum falhar, investigue a causa e proponha a correção, mas não altere código sem perguntar.
