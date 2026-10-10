// Main window side of the splash screen: report loading steps, then swap windows.
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import type { SplashStatus } from "@/splash";

const started = performance.now();
// long enough to read the logo, short enough not to annoy
const MIN_MS = 900;
let done = false;
let last = 0;

export function splashStep(text: string, progress: number) {
  if (done || progress < last) return;
  last = progress;
  // the splash may already be closed (e.g. after a hot reload): ignore
  emitTo("splashscreen", "splash-status", { text, progress } satisfies SplashStatus).catch(() => {});
}

/** Shows the main window and closes the splash. Safe to call many times. */
export function splashDone() {
  if (done) return;
  done = true;
  emitTo("splashscreen", "splash-status", { text: "Pronto", progress: 1 } satisfies SplashStatus).catch(() => {});
  const wait = Math.max(0, MIN_MS - (performance.now() - started));
  setTimeout(() => invoke("close_splash").catch((e) => console.error(e)), wait + 150);
}
