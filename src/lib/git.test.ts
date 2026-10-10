// The typed wrappers must send what the Rust commands expect, including the
// options that come from the settings (no component passes them by hand).
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { git } = await import("@/lib/git");
const { updateSettings, DEFAULTS } = await import("@/hooks/use-settings");

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  updateSettings(DEFAULTS);
});

describe("git wrappers", () => {
  it("history diffs use the context and whitespace settings", async () => {
    updateSettings({ diffContext: 8, ignoreWhitespace: true });
    await git.commitDiff("/r", "abc", "f.txt");
    expect(invoke).toHaveBeenCalledWith("commit_diff", { repo: "/r", hash: "abc", file: "f.txt", context: 8, ignoreWs: true });
  });

  it("working tree diffs never ignore whitespace (hunks must apply back)", async () => {
    updateSettings({ diffContext: 5, ignoreWhitespace: true });
    await git.workingDiff("/r", { path: "n.txt", status: "?", add: 0, del: 0 }, false);
    expect(invoke).toHaveBeenCalledWith("working_diff", { repo: "/r", file: "n.txt", staged: false, untracked: true, context: 5 });
  });

  it("pull sends the mode chosen in the settings", async () => {
    await git.pull("/r");
    expect(invoke).toHaveBeenLastCalledWith("pull", { repo: "/r", mode: "ff-only" });
    updateSettings({ pullMode: "rebase" });
    await git.pull("/r");
    expect(invoke).toHaveBeenLastCalledWith("pull", { repo: "/r", mode: "rebase" });
  });

  it("log sends the focus mode", async () => {
    invoke.mockResolvedValue([]);
    await git.log("/r", 1000, { solo: "feature", hidden: [] });
    expect(invoke).toHaveBeenCalledWith("log", { repo: "/r", limit: 1000, solo: "feature", hidden: [] });
  });

  it("hunk staging uses the same context as the diff on screen", async () => {
    updateSettings({ diffContext: 1 });
    await git.applyHunk("/r", "f.txt", 2, "stage", [0, 3]);
    expect(invoke).toHaveBeenCalledWith("apply_hunk", { repo: "/r", file: "f.txt", hunk: 2, action: "stage", lines: [0, 3], context: 1 });
  });
});
