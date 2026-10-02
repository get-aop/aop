import { afterEach, describe, expect, test } from "bun:test";
import { CUA_COMMANDS, type CuaStatus, type Project } from "@aop/common";
import { type ApiCall, mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ComputerUseSetting } = await import("./ComputerUseSetting");

const READY: CuaStatus = {
  status: "ready",
  reason: "ready",
  detail: "CUA Driver 0.32.0 is ready on this host.",
  path: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
  version: "0.32.0",
  latestVersion: "0.32.0",
  checks: [
    { id: "installed", label: "Installed", required: true, ok: true, detail: "" },
    { id: "accessibility", label: "Accessibility", required: true, ok: true, detail: "" },
    { id: "up-to-date", label: "Up to date", required: false, ok: true, detail: "" },
  ],
  host: { name: "Studio Mac", platform: "darwin" },
  checkedAt: "2026-10-01T12:00:00.000Z",
};
const NOT_INSTALLED: CuaStatus = {
  ...READY,
  status: "not-installed",
  reason: "not-installed",
  detail: "CUA Driver is not installed on this host.",
  path: null,
  version: null,
  latestVersion: null,
  checks: [{ id: "installed", label: "Installed", required: true, ok: false, detail: "" }],
};
const MISSING_GRANT: CuaStatus = {
  ...READY,
  status: "not-ready",
  reason: "missing-permissions",
  detail: "CUA Driver lacks the macOS Screen Recording permission.",
  checks: [
    { id: "accessibility", label: "Accessibility", required: true, ok: true, detail: "" },
    { id: "screen-recording", label: "Screen Recording", required: true, ok: false, detail: "" },
  ],
};

let api: ReturnType<typeof mockApi> | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
});

interface SettingOptions {
  project?: Project;
  owner?: boolean;
  cua?: CuaStatus;
}

const OWNER = { kind: "owner" };
const DEVICE = { kind: "device", device: { id: "dev_1", name: "Work Mac", createdAt: "x" } };

/** The host as this row talks to it: who the client is, CUA Driver's status, and the save. */
const host = (project: Project, options: SettingOptions) => (call: ApiCall) => {
  const saved = () => Response.json({ project: { ...project, ...(call.body as object) } });
  const answers: Record<string, () => Response> = {
    "GET /auth/me": () => Response.json(options.owner === false ? DEVICE : OWNER),
    "GET /computer-use/cua": () => Response.json(options.cua ?? READY),
    "PUT /projects/p1/computer-use": saved,
  };
  return answers[`${call.method} ${call.path.split("?")[0]}`]?.();
};

const renderSetting = async (options: SettingOptions = {}) => {
  const project = options.project ?? makeProject({ id: "p1" });
  api = mockApi(host(project, options));
  const stub = stubLiveProjects(makeState([makeEntry(project)]));
  render(
    <ProjectsProvider live={stub.live}>
      <ComputerUseSetting project={project} />
    </ProjectsProvider>,
  );
  await act(async () => {});
  return stub;
};

const openOptions = () => {
  const trigger = screen.getByTestId("settings-computer-use");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
};

describe("ComputerUseSetting", () => {
  test("starts on the model's default and shows nothing about CUA while it is ready", async () => {
    await renderSetting();

    expect(screen.getByTestId("settings-computer-use").getAttribute("data-value")).toBe(
      "model-default",
    );
    expect(screen.queryByTestId("settings-cua-status")).toBeNull();
  });

  test("offers Codex and Claude as WIP options that cannot be chosen", async () => {
    await renderSetting();
    openOptions();

    for (const id of ["codex", "claude"]) {
      const option = await screen.findByTestId(`settings-computer-use-${id}`);
      expect(option.getAttribute("data-disabled")).not.toBeNull();
      expect(option.textContent).toContain("WIP");
    }
    expect(
      (await screen.findByTestId("settings-computer-use-cua")).getAttribute("data-disabled"),
    ).toBeNull();
  });

  test("saves CUA on its own route as soon as the owner picks it", async () => {
    const stub = await renderSetting();
    openOptions();
    fireEvent.click(await screen.findByRole("option", { name: "CUA" }));

    await waitFor(() =>
      expect(api?.writes()).toEqual([
        { method: "PUT", path: "/projects/p1/computer-use", body: { computerUse: "cua" } },
      ]),
    );
    await waitFor(() => expect(stub.calls.adopted.at(-1)?.computerUse).toBe("cua"));
  });

  test("on CUA, says the driver is ready on the host, with what it checked", async () => {
    await renderSetting({ project: makeProject({ id: "p1", computerUse: "cua" }) });

    const status = await screen.findByTestId("settings-cua-status");
    expect(status.getAttribute("data-tone")).toBe("ok");
    expect(status.textContent).toContain("CUA Driver 0.32.0 is ready on this host.");
    expect(screen.getByTestId("settings-cua-check-accessibility").getAttribute("data-ok")).toBe(
      "true",
    );
    expect(screen.queryByTestId("settings-cua-guide")).toBeNull();
  });

  test("not installed: CUA stays selectable, and the guide installs it on the host", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      cua: NOT_INSTALLED,
    });

    const status = await screen.findByTestId("settings-cua-status");
    expect(status.getAttribute("data-tone")).toBe("warn");
    expect(status.textContent).toContain(
      "CUA Driver is not installed on Studio Mac. Threads run without its tools until it is.",
    );
    expect(screen.getByTestId("settings-cua-host").textContent).toContain(
      "Run these on this machine, Studio Mac: it is the AOP host.",
    );
    const steps = ["install", "start", "permissions", "config"].map((id) =>
      screen.getByTestId(`settings-cua-step-${id}`),
    );
    expect(steps).toHaveLength(4);
    const commands = screen.getAllByTestId("settings-cua-command").map((c) => c.textContent);
    expect(commands).toEqual([
      CUA_COMMANDS.install,
      CUA_COMMANDS.start,
      CUA_COMMANDS.grant,
      CUA_COMMANDS.permissionsStatus,
    ]);
    expect(screen.getByTestId("settings-cua-step-permissions").textContent).toContain(
      "System Settings › Privacy & Security › Accessibility",
    );
    openOptions();
    const option = await screen.findByTestId("settings-computer-use-cua");
    expect(option.textContent).toContain("Not ready");
    expect(option.getAttribute("data-disabled")).toBeNull();
  });

  test("installed but not ready: names the missing grant and how to give it", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      cua: MISSING_GRANT,
    });

    expect((await screen.findByTestId("settings-cua-status")).textContent).toContain(
      "CUA Driver is installed on Studio Mac but not ready.",
    );
    expect(screen.getByTestId("settings-cua-step-permissions").textContent).toContain(
      "Screen & System Audio Recording",
    );
    expect(screen.queryByTestId("settings-cua-step-install")).toBeNull();
  });

  test("Copy puts the command on the clipboard", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      cua: NOT_INSTALLED,
    });

    fireEvent.click((await screen.findAllByTestId("settings-cua-copy"))[0] as HTMLElement);

    await waitFor(() => expect(copied).toEqual([CUA_COMMANDS.install]));
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  test("a paired device is told to run the commands on the host, by name", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      owner: false,
      cua: NOT_INSTALLED,
    });

    expect((await screen.findByTestId("settings-cua-host")).textContent).toContain(
      "Run these on the AOP host, Studio Mac, not on this device.",
    );
  });

  test("on the model's default, a host that is not ready gets a line, and the guide on request", async () => {
    await renderSetting({ cua: NOT_INSTALLED });

    expect((await screen.findByTestId("settings-cua-not-ready")).textContent).toContain(
      "CUA is not ready on the AOP host, Studio Mac.",
    );
    expect(screen.queryByTestId("settings-cua-guide")).toBeNull();
    fireEvent.click(screen.getByTestId("settings-cua-show-guide"));
    expect(await screen.findByTestId("settings-cua-guide")).toBeTruthy();
  });

  test("Check again probes the host again", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      cua: NOT_INSTALLED,
    });
    fireEvent.click(await screen.findByTestId("settings-cua-recheck"));

    await waitFor(() =>
      expect(api?.calls.map((call) => call.path)).toContain("/computer-use/cua?fresh=1"),
    );
  });

  test("warns that threads on Edit files cannot use the tools", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua", threadAccess: "auto-accept-edits" }),
    });

    expect((await screen.findByTestId("settings-cua-edits-only")).textContent).toContain(
      "Full access",
    );
  });

  test("is read-only on a paired device", async () => {
    await renderSetting({ owner: false });

    expect((screen.getByTestId("settings-computer-use") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("settings-computer-use-description").textContent).toContain(
      "Only the host owner can change this",
    );
  });
});
