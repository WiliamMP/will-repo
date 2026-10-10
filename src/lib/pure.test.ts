// Pure helpers spread around the app: search, dates, file tree, contribution stats
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitBranch } from "lucide-react";
import { buildTree } from "@/components/FileBrowser";
import { countByDay, dayKey, streaks } from "@/components/Dashboard";
import { matches, type Command } from "@/lib/commands";
import { relativeDate } from "@/lib/git";

const cmd = (title: string, keywords = ""): Command => ({ id: title, title, group: "Repositório", icon: GitBranch, keywords, run: () => {} });

describe("command palette search", () => {
  it("ignores accents and case", () => {
    expect(matches(cmd("Configurações: Aparência"), "configuracoes apar")).toBe(true);
  });
  it("needs every word, in any order, from title, group or keywords", () => {
    const c = cmd("Mesclar feature em main", "merge");
    expect(matches(c, "main merge")).toBe(true);
    expect(matches(c, "repositorio")).toBe(true);
    expect(matches(c, "rebase")).toBe(false);
  });
});

describe("relativeDate", () => {
  afterEach(() => vi.useRealTimers());
  it("uses minutes, hours and days, then the date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00"));
    const now = Date.now() / 1000;
    expect(relativeDate(now - 5 * 60)).toBe("há 5 minutos");
    expect(relativeDate(now - 3 * 3600)).toBe("há 3 horas");
    expect(relativeDate(now - 86400)).toBe("ontem");
    expect(relativeDate(now - 30 * 86400)).toBe("10/09/2026");
  });
});

describe("buildTree (file browser)", () => {
  it("nests paths into folders", () => {
    const root = buildTree(["README.md", "src/App.tsx", "src/lib/git.ts"]);
    expect([...root.children.keys()]).toEqual(["README.md", "src"]);
    const src = root.children.get("src")!;
    expect(src.file).toBe(false);
    expect(src.children.get("lib")!.children.get("git.ts")).toMatchObject({ path: "src/lib/git.ts", file: true });
  });
});

describe("contribution stats", () => {
  afterEach(() => vi.useRealTimers());
  it("counts commits per day and finds the streaks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00"));
    const day = (d: number) => new Date(2026, 9, d, 10).getTime() / 1000;
    // 3 days in a row up to yesterday (today nothing yet), and an older 1-day run
    const days = countByDay([day(9), day(9), day(8), day(7), day(1)]);
    expect(days.get(dayKey(new Date(2026, 9, 9)))).toBe(2);
    expect(streaks(days)).toEqual({ current: 3, longest: 3 });
  });
});
