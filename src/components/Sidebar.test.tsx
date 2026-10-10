// Branch list: double-click checkout, right-click menus (merge, rebase, delete, focus,
// finish), tags and the filter. The actions are spies: here we check the right one is
// called with the right branch, the git side is covered by the Rust tests.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar, type BranchActions } from "@/components/Sidebar";
import type { Refs } from "@/lib/git";

const refs: Refs = {
  head: "main",
  branches: ["feature/login", "main"],
  remotes: ["origin/main"],
  tags: ["v1.0"],
};

function setup(hidden: string[] = []) {
  const actions = {
    checkout: vi.fn(),
    merge: vi.fn(),
    rebase: vi.fn(),
    remove: vi.fn(),
    pushTag: vi.fn(),
    deleteTag: vi.fn(),
    solo: vi.fn(),
    toggleHidden: vi.fn(),
    finish: vi.fn(),
    drop: vi.fn(),
  } satisfies BranchActions;
  const onSelectStash = vi.fn();
  render(
    <Sidebar
      refs={refs}
      stashes={[{ name: "stash@{0}", message: "On main: experimento", timestamp: 1 }]}
      selectedStash={null}
      onSelectStash={onSelectStash}
      actions={actions}
      hidden={hidden}
    />,
  );
  return { actions, onSelectStash };
}

/** right-click a sidebar item and pick a menu entry */
async function menu(item: string, entry: RegExp) {
  fireEvent.contextMenu(screen.getByText(item));
  await userEvent.click(await screen.findByRole("menuitem", { name: entry }));
}

describe("Sidebar", () => {
  it("double-click checks out a local or remote branch, not the current one", async () => {
    const { actions } = setup();
    await userEvent.dblClick(screen.getByText("feature/login"));
    expect(actions.checkout).toHaveBeenLastCalledWith("feature/login", false);
    await userEvent.dblClick(screen.getByText("origin/main"));
    expect(actions.checkout).toHaveBeenLastCalledWith("origin/main", true);
    await userEvent.dblClick(screen.getByText("main", { selector: "span" }));
    expect(actions.checkout).toHaveBeenCalledTimes(2);
  });

  it("branch menu: merge, rebase and delete target the clicked branch", async () => {
    const { actions } = setup();
    await menu("feature/login", /Mesclar feature\/login em main/);
    expect(actions.merge).toHaveBeenCalledWith("feature/login");
    await menu("feature/login", /Rebase de main sobre feature\/login/);
    expect(actions.rebase).toHaveBeenCalledWith("feature/login");
    await menu("feature/login", /Excluir feature\/login/);
    expect(actions.remove).toHaveBeenCalledWith("feature/login");
  });

  it("the current branch can't be deleted or merged into itself, but can be focused and finished", async () => {
    const { actions } = setup();
    fireEvent.contextMenu(screen.getByText("main", { selector: "span" }));
    await screen.findByRole("menuitem", { name: /Isolar no grafo/ });
    expect(screen.queryByRole("menuitem", { name: /Excluir/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Mesclar/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /Isolar no grafo/ }));
    expect(actions.solo).toHaveBeenCalledWith("main");
  });

  it("remote branches can't be deleted from the sidebar", async () => {
    setup();
    fireEvent.contextMenu(screen.getByText("origin/main"));
    await screen.findByRole("menuitem", { name: /Checkout/ });
    expect(screen.queryByRole("menuitem", { name: /Excluir/ })).not.toBeInTheDocument();
  });

  it("template branches offer Finalizar", async () => {
    const { actions } = setup();
    await menu("feature/login", /Finalizar feature\/login/);
    expect(actions.finish).toHaveBeenCalledWith("feature/login");
  });

  it("hidden branches show the eye and the menu offers to show them again", async () => {
    const { actions } = setup(["feature/login"]);
    expect(screen.getByLabelText("Escondida do grafo")).toBeInTheDocument();
    await menu("feature/login", /Mostrar no grafo/);
    expect(actions.toggleHidden).toHaveBeenCalledWith("feature/login");
  });

  it("tag menu pushes or deletes the tag", async () => {
    const { actions } = setup();
    await menu("v1.0", /Enviar v1.0 para origin/);
    expect(actions.pushTag).toHaveBeenCalledWith("v1.0");
    await menu("v1.0", /Excluir v1.0/);
    expect(actions.deleteTag).toHaveBeenCalledWith("v1.0");
  });

  it("filter narrows branches and remotes; stashes open on click", async () => {
    const { onSelectStash } = setup();
    await userEvent.type(screen.getByPlaceholderText("Filtrar branches..."), "LOGIN");
    expect(screen.getByText("feature/login")).toBeInTheDocument();
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("experimento"));
    expect(onSelectStash).toHaveBeenCalledWith("stash@{0}");
  });
});
