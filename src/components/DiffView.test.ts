import { describe, expect, it } from "vitest";
import { toSplit, type Row, type SplitRow } from "@/components/DiffView";
import type { DiffLine } from "@/lib/git";

let body = 0;
const row = (kind: DiffLine["kind"], text: string): Row => ({
  l: { kind, text, old: null, new: null },
  hunk: 0,
  body: kind === "hunk" ? -1 : body++,
});
/** each split row as "left | right" text, headers as "@@" */
const show = (rows: SplitRow[]) =>
  rows.map((r) => ("header" in r ? "@@" : `${r.left?.l.text ?? "·"} | ${r.right?.l.text ?? "·"}`));

describe("toSplit (side-by-side diff)", () => {
  it("pairs removed lines with the added lines that follow", () => {
    body = 0;
    const rows = [row("hunk", "@@"), row("ctx", "a"), row("del", "b"), row("del", "c"), row("add", "B"), row("ctx", "d")];
    expect(show(toSplit(rows))).toEqual(["@@", "a | a", "b | B", "c | ·", "d | d"]);
  });

  it("an add before a del starts a new pair", () => {
    body = 0;
    const rows = [row("add", "novo"), row("del", "velho"), row("add", "trocado")];
    expect(show(toSplit(rows))).toEqual(["· | novo", "velho | trocado"]);
  });

  it("keeps the body index so line staging still works in split mode", () => {
    body = 0;
    const rows = [row("hunk", "@@"), row("del", "x"), row("add", "y")];
    const [, pair] = toSplit(rows) as [SplitRow, { left: Row; right: Row }];
    expect([pair.left.body, pair.right.body]).toEqual([0, 1]);
  });
});
