import { useState } from "react";
import type { BrowserTarget } from "@/components/FileBrowser";
import type { Commit } from "@/lib/git";

export type RightTab = "details" | "changes" | "prs";
export type DropTarget = { source: string; target: string; x: number; y: number };

/**
 * What is open on screen for one repository: selected commit/stash, the tab of the
 * right panel, dialogs, file browser, terminal. Only UI state, no git calls
 * (like the visible/active properties of the forms in a Delphi app).
 */
export function usePanels() {
  const [selected, setSelected] = useState<Commit | null>(null);
  const [stashName, setStashName] = useState<string | null>(null);
  const [tab, setTab] = useState<RightTab>("details");
  const [tagTarget, setTagTarget] = useState<Commit | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);
  const [browser, setBrowser] = useState<BrowserTarget | null>(null);
  const [timeMachine, setTimeMachine] = useState(false);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const [lfsOpen, setLfsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  // drag and drop of a branch onto another: the menu shows where it was dropped
  const [dropMenu, setDropMenu] = useState<DropTarget | null>(null);

  return {
    selected,
    stashName,
    tab,
    tagTarget,
    branchOpen,
    stashOpen,
    browser,
    timeMachine,
    worktreeOpen,
    lfsOpen,
    terminalOpen,
    dropMenu,
    setSelected,
    setStashName,
    setTab,
    setTagTarget,
    setBranchOpen,
    setStashOpen,
    setBrowser,
    setTimeMachine,
    setWorktreeOpen,
    setLfsOpen,
    setTerminalOpen,
    setDropMenu,
    toggleTerminal: () => setTerminalOpen((o) => !o),
    /** show a commit's details (from the history, blame or file history) */
    showCommit: (c: Commit) => {
      setSelected(c);
      setStashName(null);
      setTab("details");
    },
    showStash: (name: string) => {
      setStashName(name);
      setTab("details");
    },
  };
}

export type Panels = ReturnType<typeof usePanels>;
