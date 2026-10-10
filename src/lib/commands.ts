// Registry of everything the command palette (Ctrl+K) can run.
// Each part of the app registers its own commands while it is on screen
// (like actions in a TActionList that the active form contributes).
import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";

export type Command = {
  id: string;
  title: string;
  group: string;
  icon: LucideIcon;
  /** extra words the search should match */
  keywords?: string;
  shortcut?: string[];
  run: () => void;
};

const owners = new Map<string, Command[]>();

/** All commands, in registration order. Read when the palette renders, so no subscription. */
export const allCommands = () => [...owners.values()].flat();

/** Registers `commands` under `owner` while the component is mounted; refreshed every render. */
export function useCommands(owner: string, commands: Command[]) {
  useEffect(() => {
    owners.set(owner, commands);
  });
  useEffect(() => () => void owners.delete(owner), [owner]);
}

// "Configurações" and "configuracoes" match each other
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Every word of the query must appear in the title, group or keywords */
export function matches(c: Command, query: string) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const text = plain(`${c.title} ${c.group} ${c.keywords ?? ""}`);
  return words.every((w) => text.includes(w));
}
