import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";

const win = getCurrentWindow();

/** mousedown on an empty part of the title bar: drag the window, double-click maximizes.
 *  `target === currentTarget` skips clicks that started on a tab or button inside it. */
export function dragWindow(e: React.MouseEvent) {
  if (e.button !== 0 || e.target !== e.currentTarget) return;
  if (e.detail === 2) win.toggleMaximize();
  else win.startDragging();
}

// Minimize / maximize / close for the custom title bar (the window has decorations: false)
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const sync = () => win.isMaximized().then(setMaximized, () => {});
    sync();
    // onResized also fires on maximize, restore and Windows snap
    const off = win.onResized(sync);
    return () => {
      off.then((f) => f());
    };
  }, []);

  const btn = "grid w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground";
  return (
    <div className="flex self-stretch">
      <button aria-label="Minimizar" title="Minimizar" className={cn(btn, "hover:bg-muted")} onClick={() => win.minimize()}>
        <Minus className="size-4" />
      </button>
      <button
        aria-label={maximized ? "Restaurar" : "Maximizar"}
        title={maximized ? "Restaurar" : "Maximizar"}
        className={cn(btn, "hover:bg-muted")}
        onClick={() => win.toggleMaximize()}
      >
        {/* Windows shows two overlapping squares for "restore" */}
        {maximized ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
      </button>
      <button
        aria-label="Fechar"
        title="Fechar"
        className={cn(btn, "hover:bg-[#e81123] hover:text-white")}
        onClick={() => win.close()}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
