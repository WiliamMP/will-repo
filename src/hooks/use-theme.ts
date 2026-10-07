import { useEffect, useState } from "react";

// "system" = follow the Windows theme and react when it changes
export type ThemeMode = "system" | "dark" | "light";

const KEY = "will-repo.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function load(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return "system";
}

// shadcn switches palettes with the "dark" class on <html>
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(load);

  useEffect(() => {
    const apply = () => {
      const dark = mode === "dark" || (mode === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    try {
      localStorage.setItem(KEY, mode);
    } catch {}
    // Like a TApplicationEvents.OnSettingChange: fires when Windows switches theme
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode]);

  return [mode, setMode] as const;
}
