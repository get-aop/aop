import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const actualClientModule = await import("../api/client");
const mockUpdateSettings = mock(async () => undefined);
mock.module("../api/client", () => ({
  ...actualClientModule,
  updateSettings: mockUpdateSettings,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { SettingsGeneral } = await import("./settings-general");

const saved = {
  max_concurrent_tasks: "5",
  watcher_poll_interval_secs: "30",
};

afterEach(() => {
  cleanup();
  mockUpdateSettings.mockClear();
});

describe("SettingsGeneral", () => {
  test("offers no Save control — settings persist on their own", () => {
    render(
      <SettingsGeneral
        savedValues={saved}
        editedValues={saved}
        onChange={() => undefined}
        onSaved={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  test("auto-saves an edited value after the debounce, not on the keystroke", async () => {
    const onSaved = mock(() => undefined);
    const edited = { ...saved, max_concurrent_tasks: "8" };

    render(
      <SettingsGeneral
        savedValues={saved}
        editedValues={edited}
        onChange={() => undefined}
        onSaved={onSaved}
      />,
    );

    expect(mockUpdateSettings).not.toHaveBeenCalled();

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith([{ key: "max_concurrent_tasks", value: "8" }]);
    expect(onSaved).toHaveBeenCalledWith([{ key: "max_concurrent_tasks", value: "8" }]);
  });

  test("does not write when nothing differs from the saved values", async () => {
    render(
      <SettingsGeneral
        savedValues={saved}
        editedValues={saved}
        onChange={() => undefined}
        onSaved={() => undefined}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  test("routes a field edit through onChange", () => {
    const onChange = mock(() => undefined);
    render(
      <SettingsGeneral
        savedValues={saved}
        editedValues={saved}
        onChange={onChange}
        onSaved={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Max Concurrent Tasks"), { target: { value: "9" } });

    expect(onChange).toHaveBeenCalledWith("max_concurrent_tasks", "9");
  });
});
