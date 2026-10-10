// End-to-end tests: the real app (e2e debug build, see build.mjs) driven by
// Microsoft Edge WebDriver attached to its WebView2.
//   npm run e2e   (builds the app first; npm run e2e:run skips the build)
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { edgeDriver } from "./edgedriver.mjs";

const PORT = 9222; // same as E2E_PORT in build.mjs
const app = path.resolve("src-tauri", "target", "debug", "will-repo.exe");
// the e2e build's own data folder (identifier + ".e2e", see build.mjs): wiped before
// every run so each run starts clean; the real app's folder is never touched
const { identifier } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const dataDir = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), `${identifier}.e2e`);
let driver;
let appProcess;

/** Waits until the app's WebView2 answers on the debugging port */
async function waitForApp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`o app não abriu a porta ${PORT}: rode npm run e2e (que gera o build de teste)`);
}

export const config = {
  runner: "local",
  specs: ["./*.e2e.mjs"], // relative to this file
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: 4444,
  // attach to the running app instead of letting the driver launch it
  // WebDriver classic: BiDi attaches to the wrong context when joining a running WebView2
  capabilities: [{ browserName: "webview2", "wdio:enforceWebDriverClassic": true, "ms:edgeOptions": { debuggerAddress: `127.0.0.1:${PORT}` } }],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  waitforTimeout: 15_000,

  async onPrepare() {
    rmSync(dataDir, { recursive: true, force: true });
    driver = spawn(await edgeDriver(), ["--port=4444"], { stdio: "ignore" });
    appProcess = spawn(app, [], { stdio: "ignore" });
    await waitForApp();
  },

  onComplete() {
    appProcess?.kill();
    driver?.kill();
  },
};
