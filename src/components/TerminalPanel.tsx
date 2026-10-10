import { useEffect, useRef, useState } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";
import { getSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

// Colors from the app theme (CSS variables), so the terminal matches Neon light/dark
function theme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v("--sidebar"),
    foreground: v("--foreground"),
    cursor: v("--primary"),
    cursorAccent: v("--sidebar"),
    selectionBackground: v("--primary") + "55",
    black: "#1e2230",
    red: v("--destructive"),
    green: v("--success"),
    yellow: v("--warning"),
    blue: v("--lane-2"),
    magenta: v("--primary"),
    cyan: v("--lane-2"),
    white: v("--foreground"),
    brightBlack: v("--muted-foreground"),
    brightMagenta: v("--accent-foreground"),
  };
}

const SHELL_NAMES: Record<string, string> = { cmd: "cmd", pwsh: "pwsh", "git-bash": "bash", powershell: "powershell", wt: "powershell" };

/** One shell session in xterm.js, connected to a pty in Rust */
function TerminalView({ cwd, active, onExit }: { cwd: string; active: boolean; onExit: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'Geist Mono Variable', 'Cascadia Code', monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: theme(),
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(box.current!);
    fit.fit();

    // the id is chosen here so the listeners exist before the shell prints anything
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    let started = false;
    const unlisten = [
      listen<{ id: number; data: string }>("pty-output", (e) => e.payload.id === id && term.write(e.payload.data)),
      listen<number>("pty-exit", (e) => e.payload === id && onExit()),
    ];
    Promise.all(unlisten)
      .then(() => invoke("pty_spawn", { id, cwd, shellKind: getSettings().terminal, cols: term.cols, rows: term.rows }))
      .then(
        () => (started = true),
        (e) => {
          toast.error(String(e));
          onExit();
        },
      );
    // keys typed (and xterm's own answers, like the cursor position) go to the shell
    const input = term.onData((data) => started && invoke("pty_write", { id, data }));
    const resize = term.onResize(({ cols, rows }) => started && invoke("pty_resize", { id, cols, rows }));
    // follow the panel size
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(box.current!);

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      unlisten.forEach((u) => u.then((f) => f()));
      invoke("pty_kill", { id });
      term.dispose();
    };
  }, [cwd]);

  // a hidden tab has size 0; fit again when it shows up
  useEffect(() => {
    if (active) requestAnimationFrame(() => fitRef.current?.fit());
  }, [active]);

  return <div ref={box} className={cn("absolute inset-0 px-2 pt-1", !active && "invisible")} />;
}

// Bottom panel with one or more terminals in the repository folder (Ctrl+`)
export function TerminalPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [tabs, setTabs] = useState<number[]>([1]);
  const [active, setActive] = useState(1);
  const next = useRef(2);
  const shell = SHELL_NAMES[getSettings().terminal] ?? "powershell";

  const add = () => {
    const n = next.current++;
    setTabs((t) => [...t, n]);
    setActive(n);
  };
  const close = (n: number) =>
    setTabs((t) => {
      const rest = t.filter((x) => x !== n);
      if (rest.length === 0) onClose();
      else if (n === active) setActive(rest[rest.length - 1]);
      return rest;
    });

  return (
    <div className="flex h-full flex-col border-t bg-sidebar">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs">
        <SquareTerminal className="mr-1 size-3.5 text-primary" />
        {tabs.map((n, i) => (
          <button
            key={n}
            onClick={() => setActive(n)}
            className={cn(
              "group flex items-center gap-1.5 rounded px-2 py-0.5 text-muted-foreground hover:text-foreground",
              n === active && "bg-accent text-accent-foreground shadow-[inset_0_-2px_0_var(--primary)]",
            )}
          >
            {shell} {tabs.length > 1 && i + 1}
            <X
              className="size-3 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                close(n);
              }}
            />
          </button>
        ))}
        <button title="Novo terminal" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={add}>
          <Plus className="size-3.5" />
        </button>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground/70" title={cwd}>
          {cwd}
        </span>
        <button title="Fechar painel (Ctrl+`)" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose}>
          <X className="size-3.5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((n) => (
          <TerminalView key={n} cwd={cwd} active={n === active} onExit={() => close(n)} />
        ))}
      </div>
    </div>
  );
}
