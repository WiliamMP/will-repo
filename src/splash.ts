// Script of the splash window (splashscreen.html). The main window loads hidden and
// reports each step here with events; Rust closes this window when it is ready.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";

export type SplashStatus = { text: string; progress: number };

const status = document.getElementById("status")!;
const bar = document.getElementById("progress")!;

listen<SplashStatus>("splash-status", ({ payload }) => {
  status.textContent = payload.text;
  bar.style.width = `${Math.round(payload.progress * 100)}%`;
});

getVersion().then((v) => (document.getElementById("version")!.textContent = `v${v}`));
