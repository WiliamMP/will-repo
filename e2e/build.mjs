// Builds the app for the end-to-end tests (debug, no installer) with two changes
// that exist only in this build:
// - its own identifier, so its data (tabs, settings) is separate from the real app
// - the WebView2 remote debugging port, which msedgedriver attaches to
//   (Tauri sets its own browser arguments, so the env var msedgedriver uses is ignored)
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const E2E_PORT = 9222;

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const args = `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=${E2E_PORT}`;
const overrides = {
  identifier: `${conf.identifier}.e2e`,
  app: { windows: conf.app.windows.map((w) => ({ ...w, additionalBrowserArgs: args })) },
};

mkdirSync("e2e/.bin", { recursive: true });
const file = path.resolve("e2e/.bin/tauri.e2e.json");
writeFileSync(file, JSON.stringify(overrides, null, 2));
execSync(`npx tauri build --debug --no-bundle --config "${file}"`, { stdio: "inherit" });
