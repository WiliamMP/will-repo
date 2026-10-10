import { useEffect, useState } from "react";
import { Columns2, Layers, Loader2, SplitSquareHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  avif: "image/avif",
};

const typeOf = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
export const isImage = (path: string) => !!typeOf(path);

/** old and new bytes of the file; empty = didn't exist in that version */
export type ImageLoader = () => Promise<[ArrayBuffer, ArrayBuffer]>;

type Side = { url: string; size: number; w: number; h: number } | null;
type Mode = "side" | "slider" | "overlay";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

// Before/after of an image: side by side, a slider that wipes from old to new,
// or the new one over the old with adjustable opacity
/** `version` changes when the content may have changed (other commit, after staging...) */
export function ImageDiff({ path, version, load }: { path: string; version: string; load: ImageLoader }) {
  const [sides, setSides] = useState<[Side, Side] | null>(null);
  const [mode, setMode] = useState<Mode>("side");
  const [pos, setPos] = useState(50);

  useEffect(() => {
    let stale = false;
    const urls: string[] = [];
    setSides(null);
    load().then(
      async (buffers) => {
        const made = await Promise.all(
          buffers.map(async (buf): Promise<Side> => {
            if (!buf.byteLength) return null;
            const url = URL.createObjectURL(new Blob([buf], { type: typeOf(path) }));
            urls.push(url);
            const img = new Image();
            img.src = url;
            await img.decode().catch(() => {});
            return { url, size: buf.byteLength, w: img.naturalWidth, h: img.naturalHeight };
          }),
        );
        if (!stale) setSides(made as [Side, Side]);
      },
      (e) => toast.error(String(e)),
    );
    return () => {
      stale = true;
      urls.forEach(URL.revokeObjectURL); // free the image memory
    };
    // `load` is a new function every render; reload only when the file or its version changes
  }, [path, version]);

  if (!sides)
    return (
      <div className="grid min-h-0 flex-1 place-items-center bg-sidebar">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );

  const [before, after] = sides;
  const both = before && after;
  const info = (s: Side, label: string, tone: string) => (
    <p className={cn("text-center font-mono text-[11px]", tone)}>
      {label}
      {s ? ` · ${s.w}×${s.h} · ${kb(s.size)}` : " · não existe"}
    </p>
  );
  // checkerboard shows transparent areas
  const checker =
    "bg-[length:16px_16px] bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)]";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b px-2">
        {(
          [
            ["side", Columns2, "Lado a lado"],
            ["slider", SplitSquareHorizontal, "Deslizar"],
            ["overlay", Layers, "Sobrepor"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            disabled={value !== "side" && !both}
            onClick={() => setMode(value)}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40",
              mode === value && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {mode === "side" || !both ? (
          <div className="grid grid-cols-2 gap-4">
            {[
              [before, "Antes", "text-destructive", "border-destructive/50"],
              [after, "Depois", "text-success", "border-success/50"],
            ].map(([s, label, tone, border]) => (
              <div key={label as string} className="flex flex-col gap-2">
                <div className={cn("grid min-h-24 place-items-center rounded-lg border-2 p-2", border as string, checker)}>
                  {s ? <img src={(s as Side)!.url} alt={label as string} className="max-h-80 max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">—</span>}
                </div>
                {info(s as Side, label as string, tone as string)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className={cn("relative inline-block max-w-full overflow-hidden rounded-lg border", checker)}>
              <img src={before.url} alt="Antes" className="block max-h-80 max-w-full" />
              {mode === "slider" ? (
                // the new image is clipped from the left up to the slider position
                <>
                  <img
                    src={after.url}
                    alt="Depois"
                    className="absolute inset-0 size-full object-contain"
                    style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
                  />
                  <span className="absolute inset-y-0 w-0.5 bg-primary shadow-[0_0_8px_var(--glow)]" style={{ left: `${pos}%` }} />
                </>
              ) : (
                <img src={after.url} alt="Depois" className="absolute inset-0 size-full object-contain" style={{ opacity: pos / 100 }} />
              )}
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-label={mode === "slider" ? "Posição do corte" : "Opacidade da nova imagem"}
              className="w-64 accent-(--primary)"
            />
            <div className="flex gap-6">
              {info(before, "Antes", "text-destructive")}
              {info(after, "Depois", "text-success")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
