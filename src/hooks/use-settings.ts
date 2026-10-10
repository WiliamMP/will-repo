import { useSyncExternalStore } from "react";

// App preferences, saved in localStorage. The theme keeps its own key (use-theme.ts).
export type Settings = {
  /** interface zoom: 0.9 .. 1.25 */
  zoom: number;
  /** 0 = off */
  autoFetchMinutes: number;
  pullMode: "ff-only" | "rebase" | "merge";
  /** lines of context around each change (-U) */
  diffContext: number;
  /** history and stash diffs only; working tree diffs must apply back */
  ignoreWhitespace: boolean;
  /** command like "code"; "" = the file's default app */
  editor: string;
  terminal: "wt" | "powershell" | "pwsh" | "cmd" | "git-bash";
};

export const DEFAULTS: Settings = {
  zoom: 1,
  autoFetchMinutes: 5,
  pullMode: "ff-only",
  diffContext: 3,
  ignoreWhitespace: false,
  editor: "",
  terminal: "wt",
};

const KEY = "will-repo.settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    // spread over the defaults: settings added later get their default value
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

// One shared copy for the whole app (like a global TSettings object), with listeners
// so every component using it re-renders on change.
let current = load();
const listeners = new Set<() => void>();

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSettings() {
  return useSyncExternalStore(subscribe, getSettings);
}
