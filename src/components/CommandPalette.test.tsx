import { useEffect, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArrowDownToLine, GitBranch, RefreshCw } from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { useCommands, type Command } from "@/lib/commands";

/** A view that registers its commands, like RepoView does, plus the palette */
function App({ commands }: { commands: Command[] }) {
  useCommands("test", commands);
  // opens after the first render, like Ctrl+K once the view is on screen
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}

const make = () => {
  const fetch = vi.fn();
  const pull = vi.fn();
  const checkout = vi.fn();
  const commands: Command[] = [
    { id: "fetch", title: "Fetch", group: "Repositório", icon: RefreshCw, shortcut: ["Ctrl", "Shift", "F"], run: fetch },
    { id: "pull", title: "Pull", group: "Repositório", icon: ArrowDownToLine, run: pull },
    { id: "co", title: "Checkout feature/login", group: "Branches", icon: GitBranch, keywords: "trocar", run: checkout },
  ];
  return { commands, fetch, pull, checkout };
};

describe("CommandPalette", () => {
  it("lists the registered commands by group, with shortcuts", async () => {
    const { commands } = make();
    render(<App commands={commands} />);
    expect(await screen.findByText("Repositório")).toBeInTheDocument();
    expect(screen.getByText("Branches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fetch/ })).toHaveTextContent("Shift");
  });

  it("filters while typing and Enter runs the first match", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { commands, pull, checkout } = make();
    render(<App commands={commands} />);
    const input = await screen.findByPlaceholderText("O que você quer fazer?");
    await userEvent.type(input, "trocar");
    expect(screen.queryByRole("button", { name: /Fetch/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Checkout feature\/login/ })).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    vi.runAllTimers(); // the command runs right after the palette closes
    expect(checkout).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("arrows move the selection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { commands, fetch, pull } = make();
    render(<App commands={commands} />);
    await screen.findByPlaceholderText("O que você quer fazer?");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    vi.runAllTimers();
    expect(pull).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("says so when nothing matches", async () => {
    const { commands } = make();
    render(<App commands={commands} />);
    await userEvent.type(await screen.findByPlaceholderText("O que você quer fazer?"), "xyzzy");
    expect(screen.getByText("Nenhum comando.")).toBeInTheDocument();
  });
});
