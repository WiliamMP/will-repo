import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommitAssist, withType } from "@/components/CommitAssist";

describe("withType", () => {
  it("adds the type to a plain title", () => {
    expect(withType("add login", "feat")).toBe("feat: add login");
  });
  it("swaps the type keeping scope, ! and the body", () => {
    expect(withType("feat(ui)!: nova tela\n\n- corpo", "fix")).toBe("fix(ui)!: nova tela\n\n- corpo");
  });
  it("the same type again removes it", () => {
    expect(withType("docs: readme", "docs")).toBe("readme");
  });
});

/** CommitAssist controls nothing itself: the message lives in the parent */
function Harness({ initial = "", onSuggest }: { initial?: string; onSuggest?: () => Promise<string> }) {
  const [message, setMessage] = useState(initial);
  return (
    <>
      <CommitAssist message={message} onChange={setMessage} recent={["feat: antigo", "fix: outro"]} onSuggest={onSuggest} />
      <output data-testid="msg">{message}</output>
    </>
  );
}

describe("CommitAssist", () => {
  it("chips set the type and mark the active one", async () => {
    render(<Harness initial="ajusta botão" />);
    await userEvent.click(screen.getByRole("button", { name: "fix" }));
    expect(screen.getByTestId("msg")).toHaveTextContent("fix: ajusta botão");
    await userEvent.click(screen.getByRole("button", { name: "feat" }));
    expect(screen.getByTestId("msg")).toHaveTextContent("feat: ajusta botão");
  });

  it("counts the title only and warns past 50 and 72 characters", () => {
    const { rerender } = render(<CommitAssist message={"a".repeat(40) + "\ncorpo longo"} onChange={() => {}} recent={[]} />);
    expect(screen.getByText("40/72")).not.toHaveClass("text-warning");
    rerender(<CommitAssist message={"a".repeat(60)} onChange={() => {}} recent={[]} />);
    expect(screen.getByText("60/72")).toHaveClass("text-warning");
    rerender(<CommitAssist message={"a".repeat(80)} onChange={() => {}} recent={[]} />);
    expect(screen.getByText("80/72")).toHaveClass("text-destructive");
  });

  it("recent messages fill the box", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /Recentes/ }));
    await userEvent.click(screen.getByRole("button", { name: "fix: outro" }));
    expect(screen.getByTestId("msg")).toHaveTextContent("fix: outro");
  });

  it("Sugerir is off with nothing staged and fills the message from Claude", async () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("button", { name: /Sugerir/ })).toBeDisabled();
    unmount();

    const suggest = vi.fn().mockResolvedValue("docs: atualiza README");
    render(<Harness onSuggest={suggest} />);
    await userEvent.click(screen.getByRole("button", { name: /Sugerir/ }));
    expect(suggest).toHaveBeenCalledOnce();
    expect(await screen.findByTestId("msg")).toHaveTextContent("docs: atualiza README");
  });
});
