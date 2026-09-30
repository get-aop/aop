import { describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { fireEvent, render, screen } = await import("@testing-library/react");
const { RuntimeProfilePicker } = await import("./RuntimeProfilePicker");

const profiles = [
  {
    id: "rprof_work",
    name: "Work Claude",
    baseProvider: "claude-code" as const,
    command: "cpe",
    model: "claude-opus-5",
    reasoning: "high" as const,
    fastMode: true,
    createdAt: "now",
    updatedAt: "now",
  },
  {
    id: "rprof_personal",
    name: "Personal Claude",
    baseProvider: "claude-code" as const,
    command: "claude-personal",
    model: "claude-sonnet-4-6",
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
    expect(screen.queryByRole("option", { name: "Personal Claude" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Work Claude" }));
    expect(onApply).toHaveBeenCalledWith(profiles[0]);
  });
});
