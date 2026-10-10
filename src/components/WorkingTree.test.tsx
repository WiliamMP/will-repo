// The "Alterações" tab: the destructive flows (discard), stage/unstage and commit/amend.
// git goes through `invoke` (mocked); the native confirm dialog and the toasts are mocked too.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileChange, RepoState, Status } from "@/lib/git";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const ask = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => ask(...a) }));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { WorkingTree } = await import("@/components/WorkingTree");

const file = (path: string, status = "M"): FileChange => ({ path, status, add: 1, del: 0 });
const clean: RepoState = { kind: null, label: "", step: null };
/** like useRepo's run: does the git action and reports success */
const run = vi.fn(async (_label: string, action: (path: string) => Promise<unknown>) => {
  await action("/r");
  return true;
});
/** the commands sent to Rust, without the diff loads that happen on their own */
const calls = () => invoke.mock.calls.filter(([cmd]) => cmd !== "working_diff");

function setup(status: Partial<Status>, extra: { headPushed?: boolean; state?: RepoState } = {}) {
  const full: Status = { staged: [], unstaged: [], conflicted: [], ...status };
  return render(
    <WorkingTree
      repo="/r"
      status={full}
      state={extra.state ?? clean}
      headPushed={extra.headPushed ?? false}
      recent={[]}
      onFileHistory={() => {}}
      run={run}
    />,
  );
}

/** the row of a file in the list, to click its own buttons */
const row = (path: string) => screen.getByText(path).closest("li")!;

beforeEach(() => {
  invoke.mockReset().mockResolvedValue([]);
  ask.mockReset();
  run.mockClear();
  Object.values(toast).forEach((f) => f.mockClear());
});

describe("WorkingTree", () => {
  it("stages one file and all files", async () => {
    setup({ unstaged: [file("a.txt"), file("b.txt", "?")] });
    await userEvent.click(within(row("a.txt")).getByRole("button", { name: "Preparar" }));
    expect(calls()).toContainEqual(["stage", { repo: "/r", files: ["a.txt"] }]);
    await userEvent.click(screen.getByTitle("Preparar todos os arquivos"));
    expect(calls()).toContainEqual(["stage", { repo: "/r", files: ["a.txt", "b.txt"] }]);
  });

  it("unstages a staged file", async () => {
    setup({ staged: [file("a.txt")] });
    await userEvent.click(within(row("a.txt")).getByRole("button", { name: "Remover do stage" }));
    expect(calls()).toContainEqual(["unstage", { repo: "/r", files: ["a.txt"] }]);
  });

  it("discards without asking, then offers undo that restores the backup", async () => {
    setup({ unstaged: [file("a.txt")] });
    await userEvent.click(within(row("a.txt")).getByRole("button", { name: "Descartar" }));
    expect(ask).not.toHaveBeenCalled(); // backed up in Rust: no "are you sure?"
    expect(calls()).toContainEqual(["discard", { repo: "/r", files: [file("a.txt")] }]);

    // the toast's "Desfazer" restores the newest backup
    const [message, options] = toast.success.mock.lastCall!;
    expect(message).toContain("a.txt");
    invoke.mockImplementation(async (cmd: string) => (cmd === "discard_list" ? [{ hash: "bk1", timestamp: 1, files: ["a.txt"] }] : undefined));
    options.action.onClick();
    await vi.waitFor(() => expect(calls()).toContainEqual(["restore_discard", { repo: "/r", hash: "bk1" }]));
  });

  it("commit needs a message and something staged; Ctrl+Enter commits", async () => {
    const { unmount } = setup({ unstaged: [file("a.txt")] });
    await userEvent.type(screen.getByPlaceholderText(/Mensagem do commit/), "feat: x");
    expect(screen.getByRole("button", { name: /Commit/ })).toBeDisabled(); // nothing staged
    unmount();

    setup({ staged: [file("a.txt")] });
    const box = screen.getByPlaceholderText(/Mensagem do commit/);
    await userEvent.type(box, "feat: nova tela{Control>}{Enter}{/Control}");
    expect(calls()).toContainEqual(["commit", { repo: "/r", message: "feat: nova tela", amend: false }]);
    expect(box).toHaveValue(""); // cleared after a successful commit
  });

  it("amend loads the last message and warns when the commit was already pushed", async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === "commit_message" ? "fix: antigo" : []));
    setup({}, { headPushed: true });
    await userEvent.click(screen.getByRole("checkbox"));
    expect(await screen.findByDisplayValue("fix: antigo")).toBeInTheDocument();

    ask.mockResolvedValue(false); // the user says no
    await userEvent.click(screen.getByRole("button", { name: /Amend/ }));
    expect(ask).toHaveBeenCalledOnce();
    expect(calls().some(([cmd]) => cmd === "commit")).toBe(false);

    ask.mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: /Amend/ }));
    expect(calls()).toContainEqual(["commit", { repo: "/r", message: "fix: antigo", amend: true }]);
  });

  it("during a rebase the message box is off (commits come from Continuar)", () => {
    setup({ staged: [file("a.txt")] }, { state: { kind: "rebase", label: "Rebase de main", step: "1/2" } });
    expect(screen.getByPlaceholderText(/Rebase em andamento/)).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});
