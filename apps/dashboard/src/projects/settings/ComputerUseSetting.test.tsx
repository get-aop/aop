import { afterEach, describe, expect, test } from "bun:test";
import type { CuaStatus, Project } from "@aop/common";
import { type ApiCall, mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ComputerUseSetting } = await import("./ComputerUseSetting");
const { savePhase } = await import("./section-test-utils");
const { getDialogs, resetDialogs } = await import("../../shell/dialog-store");
const { refreshAgentClis, resetAgentClisForTests } = await import(
  "../../agent-clis/agent-cli-store"
);

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
  fix: { command: null, sudoCommand: null, missing: [], pinnedVersion: "0.32.0" },
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
  fix: { ...READY.fix, command: "aop-nightly computer-use setup", missing: ["CUA Driver"] },
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
  resetAgentClisForTests();
  resetDialogs();
});

interface SettingOptions {
  project?: Project;
  owner?: boolean;
  cua?: CuaStatus;
  /** The host owner turned on Skip permission checks. */
  hostBypass?: boolean;
}

const OWNER = { kind: "owner" };
const DEVICE = { kind: "device", device: { id: "dev_1", name: "Work Mac", createdAt: "x" } };

/** The host as this row talks to it: who the client is, CUA Driver's status, and the save. */
const host = (project: Project, options: SettingOptions) => (call: ApiCall) => {
  const saved = () => Response.json({ project: { ...project, ...(call.body as object) } });
  const answers: Record<string, () => Response> = {
    "GET /auth/me": () => Response.json(options.owner === false ? DEVICE : OWNER),
    "GET /computer-use/cua": () => Response.json(options.cua ?? READY),
    "GET /agent-clis": () =>
      Response.json({
        clis: [],
        checkIntervalMinutes: 60,
        autoUpdate: false,
        skipPermissions: { enabled: options.hostBypass === true, blockedReason: null },
      }),
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
    // It says so on its row, like every project setting.
    await waitFor(() => expect(savePhase("settings-computer-use")).toBe("saved"));
  });

  test("on CUA, says the driver is ready on the host, with what it checked", async () => {
    await renderSetting({ project: makeProject({ id: "p1", computerUse: "cua" }) });

    const status = await screen.findByTestId("settings-cua-status");
    expect(status.getAttribute("data-tone")).toBe("ok");
    expect(status.textContent).toContain("CUA Driver 0.32.0 is ready on Studio Mac.");
    expect(screen.getByTestId("settings-cua-check-accessibility").getAttribute("data-ok")).toBe(
      "true",
    );
    expect(screen.queryByTestId("settings-cua-guide")).toBeNull();
  });

  test("not installed: CUA stays selectable, and the setup is one click away on AOP settings › Host", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      cua: NOT_INSTALLED,
    });

    const status = await screen.findByTestId("settings-cua-status");
    expect(status.getAttribute("data-tone")).toBe("warn");
    expect(status.textContent).toContain(
      "CUA Driver is not installed on Studio Mac. Threads run without its tools until it is.",
    );
    expect(screen.getByTestId("settings-cua-host").textContent).toBe(
      "Set it up on this machine, Studio Mac: it is the AOP host.",
    );
    expect(screen.queryByTestId("settings-cua-step-install")).toBeNull();
    fireEvent.click(screen.getByTestId("settings-cua-open-host"));
    expect(getDialogs().settings).toEqual({ open: true, section: "host" });
    openOptions();
    const option = await screen.findByTestId("settings-computer-use-cua");
    expect(option.textContent).toContain("Not ready");
    expect(option.getAttribute("data-disabled")).toBeNull();
  });

  test("installed but not ready: says so, with what the host found", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      cua: MISSING_GRANT,
    });

    expect((await screen.findByTestId("settings-cua-status")).textContent).toContain(
      "CUA Driver is installed on Studio Mac but not ready.",
    );
    expect(screen.getByTestId("settings-cua-open-host")).toBeTruthy();
  });

  test("a paired device is told the setup happens on the host, by name", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      owner: false,
      cua: NOT_INSTALLED,
    });

    expect((await screen.findByTestId("settings-cua-host")).textContent).toBe(
      "Set it up on the AOP host, Studio Mac, not on this device.",
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

  test("drops that warning while the host skips permission checks for every thread", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua", threadAccess: "auto-accept-edits" }),
      hostBypass: true,
    });
    await act(() => refreshAgentClis());

    expect(await screen.findByTestId("settings-cua-status")).toBeTruthy();
    expect(screen.queryByTestId("settings-cua-edits-only")).toBeNull();
  });

  test("is read-only on a paired device", async () => {
    await renderSetting({ owner: false });

    expect((screen.getByTestId("settings-computer-use") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("settings-computer-use-description").textContent).toContain(
      "Only the host owner can change this",
    );
  });
});
