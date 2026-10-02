import { afterEach, describe, expect, test } from "bun:test";
import type { CuaStatus, Project } from "@aop/common";
import { type ApiCall, mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ComputerUseSetting } = await import("./ComputerUseSetting");

const READY: CuaStatus = {
  state: "ready",
  usable: true,
  path: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
  version: "0.32.0",
  detail: "CUA Driver 0.32.0 is installed and has its macOS permissions.",
  fix: [],
};
const NOT_INSTALLED: CuaStatus = {
  state: "not-installed",
  usable: false,
  path: null,
  version: null,
  detail: "CUA Driver is not installed on this host.",
  fix: ['/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"'],
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

  test("on CUA, says the driver is ready", async () => {
    await renderSetting({ project: makeProject({ id: "p1", computerUse: "cua" }) });

    const status = await screen.findByTestId("settings-cua-status");
    expect(status.getAttribute("data-tone")).toBe("ok");
    expect(status.textContent).toContain("CUA Driver 0.32.0 is installed");
  });

  test("says why CUA is not ready, that threads run without it, and what to run", async () => {
    await renderSetting({
      project: makeProject({ id: "p1", computerUse: "cua" }),
      cua: NOT_INSTALLED,
    });

    const status = await screen.findByTestId("settings-cua-status");
    expect(status.getAttribute("data-tone")).toBe("warn");
    expect(status.textContent).toContain("threads run without its tools");
    expect(status.textContent).toContain("CUA Driver is not installed on this host.");
    expect(screen.getByTestId("settings-cua-fix").textContent).toContain(
      "https://cua.ai/driver/install.sh",
    );
    openOptions();
    expect((await screen.findByTestId("settings-computer-use-cua")).textContent).toContain(
      "Not ready",
    );
  });

  test("probes the driver again when asked", async () => {
    await renderSetting({ cua: NOT_INSTALLED });
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
