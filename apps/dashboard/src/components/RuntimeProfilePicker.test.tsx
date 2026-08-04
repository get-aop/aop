import { describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { fireEvent, render, screen } = await import("@testing-library/react");
const { RuntimeProfilePicker } = await import("./RuntimeProfilePicker");

const profiles = [
  {
    id: "rprof_codex",
    name: "Work Codex",
    baseProvider: "codex-cli" as const,
    command: "cdx",
    model: "gpt-5.5",
    reasoning: "high" as const,
    fastMode: true,
    createdAt: "now",
    updatedAt: "now",
  },
  {
    id: "rprof_pi",
    name: "Work PI",
    baseProvider: "pi" as const,
    command: "pi",
    model: "openai-codex/gpt-5.5",
    reasoning: "medium" as const,
    fastMode: false,
    createdAt: "now",
    updatedAt: "now",
  },
];

describe("RuntimeProfilePicker", () => {
  test("applies any saved runtime profile", () => {
    const onApply = mock();
    render(<RuntimeProfilePicker profiles={profiles} onApply={onApply} />);

    const trigger = screen.getByRole("combobox", { name: "Apply profile" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    expect(screen.queryByRole("option", { name: "Work PI" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Work Codex" }));
    expect(onApply).toHaveBeenCalledWith(profiles[0]);
  });
});
