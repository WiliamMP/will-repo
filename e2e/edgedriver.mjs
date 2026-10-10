// tauri-driver talks to the app through Microsoft Edge WebDriver, which must be the
// exact version of the WebView2 runtime installed. This finds that version and
// downloads the matching msedgedriver.exe (official Microsoft server) once.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const KEY = String.raw`HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`;

export function webview2Version() {
  const out = execFileSync("reg", ["query", KEY, "/v", "pv"], { encoding: "utf8" });
  const v = out.match(/pv\s+REG_SZ\s+([\d.]+)/)?.[1];
  if (!v) throw new Error("WebView2 não encontrado");
  return v;
}

/** Path to msedgedriver.exe matching the installed WebView2, downloading it if needed */
export async function edgeDriver() {
  const version = webview2Version();
  const dir = path.resolve("e2e", ".bin", version);
  const exe = path.join(dir, "msedgedriver.exe");
  if (existsSync(exe)) return exe;

  mkdirSync(dir, { recursive: true });
  const url = `https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`;
  console.log(`Baixando msedgedriver ${version}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const zip = path.join(dir, "edgedriver.zip");
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // tar ships with Windows 10+ and reads zip files
  execFileSync("tar", ["-xf", zip, "-C", dir]);
  if (!existsSync(exe)) throw new Error("msedgedriver.exe não veio no zip");
  return exe;
}

// node e2e/edgedriver.mjs  -> just download and print the path
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await edgeDriver());
}
