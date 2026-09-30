import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const actualClientModule = await import("../api/client");
const mockUpdateSettings = mock(async () => undefined);
mock.module("../api/client", () => ({
  ...actualClientModule,
  updateSettings: mockUpdateSettings,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { useState } = await import("react");
const { ApiError } = await import("../api/request");
const { mergeSavedSettings, SettingsGeneral } = await import("./settings-general");

const saved = {
  chat_global_instructions: "Be concise.",
};

/** The dialog's own wiring: edits live in state, and a save folds back into what is saved. */
const Harness = () => {
  const initial = { ...saved, max_concurrent_runs: "4", update_check: "true" };
  const [savedValues, setSavedValues] = useState<Record<string, string>>(initial);
  const [editedValues, setEditedValues] = useState<Record<string, string>>(initial);
  return (
    <SettingsGeneral
      savedValues={savedValues}
      editedValues={editedValues}
      onChange={(key, value) => setEditedValues((current) => ({ ...current, [key]: value }))}
      onSaved={(settings) => {
        setSavedValues((current) => mergeSavedSettings(current, settings));
        setEditedValues((current) => mergeSavedSettings(current, settings));
      }}
    />
  );
};

const capInput = () => screen.getByTestId("setting-max_concurrent_runs") as HTMLInputElement;
const type = (value: string) => fireEvent.change(capInput(), { target: { value } });
// Longer than the auto-save debounce, so a save that was going to happen has happened.
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 800));

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
    const edited = { ...saved, chat_global_instructions: "Be concise. No jargon." };

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
    expect(mockUpdateSettings).toHaveBeenCalledWith([
      { key: "chat_global_instructions", value: "Be concise. No jargon." },
    ]);
    expect(onSaved).toHaveBeenCalledWith([
      { key: "chat_global_instructions", value: "Be concise. No jargon." },
    ]);
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

    fireEvent.change(screen.getByLabelText("Global instructions"), {
      target: { value: "Be brief." },
    });

    expect(onChange).toHaveBeenCalledWith("chat_global_instructions", "Be brief.");
  });

  test("shows the concurrent runs setting with its current value and no error", () => {
    render(<Harness />);

    expect(screen.getByLabelText("Concurrent thread runs")).toBe(capInput());
    expect(capInput().value).toBe("4");
    expect(capInput().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByTestId("setting-error-max_concurrent_runs")).toBeNull();
  });

  test("turns the daily update check off from a switch and saves it as 'false'", async () => {
    render(<Harness />);

    const toggle = screen.getByLabelText("Check for updates");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith([{ key: "update_check", value: "false" }]);
    expect(screen.getByLabelText("Check for updates").getAttribute("aria-checked")).toBe("false");
  });

  test("saves a valid run cap after the debounce, and only the key that changed", async () => {
    render(<Harness />);

    type("1");
    expect(mockUpdateSettings).not.toHaveBeenCalled();

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith([{ key: "max_concurrent_runs", value: "1" }]);
    expect(capInput().value).toBe("1");
  });

  test.each(["0", "33", "", "4.5", "abc"])(
    "run cap %p is flagged under the field and never sent",
    async (value) => {
      render(<Harness />);

      type(value);

      const error = screen.getByTestId("setting-error-max_concurrent_runs");
      expect(error.getAttribute("role")).toBe("alert");
      expect(error.textContent).toBe("Enter a whole number from 1 to 32.");
      expect(capInput().getAttribute("aria-invalid")).toBe("true");
      expect(capInput().getAttribute("aria-describedby")).toBe(error.id);
      expect(capInput().value).toBe(value);

      await pastDebounce();
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    },
  );

  test("the error clears once the value is a valid cap, and then it is saved", async () => {
    render(<Harness />);

    type("0");
    expect(screen.getByTestId("setting-error-max_concurrent_runs")).toBeTruthy();

    type("32");
    expect(screen.queryByTestId("setting-error-max_concurrent_runs")).toBeNull();
    expect(capInput().getAttribute("aria-invalid")).toBeNull();

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith([{ key: "max_concurrent_runs", value: "32" }]);
  });

  test("an invalid run cap does not hold back another edit that is valid", async () => {
    render(<Harness />);

    type("");
    fireEvent.change(screen.getByLabelText("Global instructions"), {
      target: { value: "Be brief." },
    });

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings).toHaveBeenCalledWith([
      { key: "chat_global_instructions", value: "Be brief." },
    ]);
    // The half-typed cap is still on screen, still flagged, still unsent.
    expect(capInput().value).toBe("");
    expect(screen.getByTestId("setting-error-max_concurrent_runs")).toBeTruthy();
  });

  test("a save the host refuses is reported with the reason and the edit stays", async () => {
    const failure = spyOn(toast, "error").mockImplementation(() => "");
    mockUpdateSettings.mockRejectedValueOnce(new ApiError(400, "UNKNOWN", "Invalid value"));
    render(<Harness />);

    type("8");

    await waitFor(() => expect(failure).toHaveBeenCalledWith("Save failed: Invalid value"));
    expect(capInput().value).toBe("8");
    failure.mockRestore();
  });
});
