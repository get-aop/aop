import { afterEach, describe, expect, mock, test } from "bun:test";
import type { DesktopBackend, WslDistro } from "../backend/types";
import { setupDesktopDom } from "../test/setup-dom";
import { ExecHostMenu } from "./ExecHostMenu";

setupDesktopDom();

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

afterEach(cleanup);

const createBackend = (overrides: Partial<DesktopBackend> = {}): DesktopBackend => ({
  getSetupState: mock(async () => ({
    ready: true,
    requirements: [],
    runtimes: [],
    blockingRequirements: [],
  })),
  runSetupAction: mock(async () => ({
    ready: true,
    requirements: [],
    runtimes: [],
    blockingRequirements: [],
  })),
  openSetupGuide: mock(async () => undefined),
  startAopSidecar: mock(async () => ({ status: "ready" as const })),
  getSidecarState: mock(async () => ({ status: "ready" as const })),
  openLogsFolder: mock(async () => undefined),
  quitApp: mock(async () => undefined),
  listWslDistros: mock(async () => [] as WslDistro[]),
  getExecHost: mock(async () => "native"),
  setExecHost: mock(async () => undefined),
  ...overrides,
});

describe("ExecHostMenu", () => {
  test("focuses the selected row and closes like the shared AOP dropdown", async () => {
    const backend = createBackend({
      listWslDistros: mock(async () => [
        { name: "Ubuntu", isDefault: true, running: true, version: 2 },
      ]),
    });
    const view = render(<ExecHostMenu backend={backend} onChanged={() => undefined} />);

    const trigger = await view.findByRole("button", { name: "Run agents in" });
    fireEvent.click(trigger);

    const selected = view.getByRole("menuitemradio", { name: "Ubuntu (default)" });
    await waitFor(() => expect(document.activeElement).toBe(selected));

    fireEvent.keyDown(selected, { key: "Escape" });
    expect(view.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(view.queryByRole("menu")).toBeNull();
  });

  test("uses WSL exclusively, selects the default distro, and persists changes", async () => {
    const setExecHost = mock(async () => undefined);
    const onChanged = mock(() => undefined);
    const backend = createBackend({
      listWslDistros: mock(async () => [
        { name: "Ubuntu", isDefault: true, running: true, version: 2 },
        { name: "Debian", isDefault: false, running: false, version: 2 },
      ]),
      getExecHost: mock(async () => "native"),
      setExecHost,
    });

    const view = render(<ExecHostMenu backend={backend} onChanged={onChanged} />);

    const trigger = await view.findByRole("button", { name: "Run agents in" });
    await waitFor(() => expect(trigger.textContent).toContain("Ubuntu (default)"));
    expect(setExecHost).toHaveBeenCalledWith("wsl:Ubuntu");

    fireEvent.click(trigger);
    expect(view.getByRole("menu").className).toContain("exec-host-menu");
    expect(view.queryByRole("menuitemradio", { name: "Native Windows" })).toBeNull();

    await act(async () => {
      fireEvent.click(view.getByRole("menuitemradio", { name: "Debian" }));
    });

    expect(setExecHost).toHaveBeenCalledWith("wsl:Debian");
    expect(onChanged).toHaveBeenCalled();
  });

  test("renders nothing when WSL is unavailable (native-only fallback)", async () => {
    const backend = createBackend({
      listWslDistros: mock(async () => {
        throw new Error("WSL not installed");
      }),
    });

    const view = render(<ExecHostMenu backend={backend} onChanged={() => undefined} />);

    await waitFor(() => expect(view.queryByRole("button", { name: "Run agents in" })).toBeNull());
  });

  test("renders nothing when there are zero distros", async () => {
    const backend = createBackend({ listWslDistros: mock(async () => []) });

    const view = render(<ExecHostMenu backend={backend} onChanged={() => undefined} />);

    await waitFor(() => expect(view.queryByRole("button", { name: "Run agents in" })).toBeNull());
  });
});
