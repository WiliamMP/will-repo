import { useEffect } from "react";

type Shortcuts = {
  busy: string | null;
  reload: () => void;
  undo: () => void;
  toggleTerminal: () => void;
  fetch: () => void;
  pull: () => void;
  push: () => void;
};

/**
 * Keyboard shortcuts of a repository tab (like a TActionList's ShortCut properties),
 * and a refresh when the window gets focus (files may change in the editor or terminal).
 */
export function useRepoShortcuts(s: Shortcuts) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "F5") {
        e.preventDefault();
        s.reload();
      } else if (e.ctrlKey && e.code === "Backquote") {
        // physical key, so it also works on ABNT2 keyboards where ` is a dead key
        e.preventDefault();
        s.toggleTerminal();
      } else if (e.ctrlKey && !e.shiftKey && k === "z" && !typing && !s.busy) {
        // inside a text box Ctrl+Z keeps undoing text
        e.preventDefault();
        s.undo();
      } else if (e.ctrlKey && e.shiftKey && !s.busy) {
        const action = { f: s.fetch, l: s.pull, p: s.push }[k];
        if (action) {
          e.preventDefault();
          action();
        }
      }
    };
    const onFocus = () => s.reload();
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", onFocus);
    };
  });
}
