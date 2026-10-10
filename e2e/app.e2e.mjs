// The real app, real git: opens a throwaway repository, browses the history,
// stages and commits through the UI, and uses the command palette.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";

const repo = mkdtempSync(path.join(os.tmpdir(), "will-repo-e2e-repo-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const repoPath = () => git("rev-parse", "--show-toplevel");

/** The splash closes itself; the tests talk to the main window */
async function mainWindow() {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, {
    timeout: 20_000,
    timeoutMsg: "a splash não fechou",
  });
  await browser.switchToWindow((await browser.getWindowHandles())[0]);
}

describe("will-repo", () => {
  before(async () => {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "E2E");
    git("config", "user.email", "e2e@example.com");
    writeFileSync(path.join(repo, "a.txt"), "um\n");
    git("add", ".");
    git("commit", "-qm", "primeiro commit");
    writeFileSync(path.join(repo, "a.txt"), "um\ndois\n");
    git("commit", "-qam", "segundo commit");
    await mainWindow();
  });

  after(() => rmSync(repo, { recursive: true, force: true }));

  it("abre no dashboard depois da splash", async () => {
    await expect($("h2=Projetos")).toBeDisplayed();
  });

  it("mostra o histórico de um repositório aberto em aba", async () => {
    // same as Ctrl+O, without the native folder dialog (WebDriver can't drive it)
    await browser.execute((p) => localStorage.setItem("will-repo.tabs", JSON.stringify({ paths: [p], active: p })), repoPath());
    await browser.refresh();
    await expect($("span=segundo commit")).toBeDisplayed();
    await expect($("span=primeiro commit")).toBeDisplayed();
  });

  it("prepara e faz commit pela interface", async () => {
    writeFileSync(path.join(repo, "novo.txt"), "arquivo novo\n");
    await browser.keys("F5");
    await $("button*=Alterações").click();
    await $("span=novo.txt").waitForDisplayed();
    await $('button[title="Preparar todos os arquivos"]').click();
    await expect($("div*=Preparados (1)")).toBeDisplayed();

    const box = $("textarea");
    await box.setValue("feat: commit feito pelo teste e2e");
    await browser.keys(["Control", "Enter"]);

    await browser.waitUntil(() => git("log", "-1", "--format=%s") === "feat: commit feito pelo teste e2e", {
      timeoutMsg: "o commit não chegou no git",
    });
    await expect($("span=feat: commit feito pelo teste e2e")).toBeDisplayed();
    expect(git("status", "--porcelain")).toBe("");
  });

  it("nada foi bloqueado pelo Content Security Policy", async () => {
    // visit the screens with images and the terminal, then check what the app logged
    await $("button*=Pull Requests").click();
    await $("button*=Detalhes").click();
    await browser.keys(["Control", "`"]);
    await $(".xterm").waitForDisplayed();
    await browser.keys(["Control", "`"]);
    expect(await browser.execute(() => window.__cspViolations)).toEqual([]);
  });

  it("paleta de comandos (Ctrl+K) executa uma ação", async () => {
    await browser.keys(["Control", "k"]);
    const input = $('input[placeholder="O que você quer fazer?"]');
    await input.waitForDisplayed();
    await input.setValue("mostrar detalhes");
    await browser.keys("Enter");
    await expect(input).not.toBeDisplayed();
    // the details panel of the selected commit is back
    await expect($("button=Arquivos")).toBeDisplayed();
  });
});
