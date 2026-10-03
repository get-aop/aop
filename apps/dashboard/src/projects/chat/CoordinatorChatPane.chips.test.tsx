import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, screen } = await import("@testing-library/react");
const { mockFetch, settled, setup } = await import("./pane-test-harness");

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/prj_1");
  net = mockFetch();
});

afterEach(() => {
  cleanup();
  net.restore();
});

describe("the coordinator's model and effort", () => {
  test("the chips show what the project's coordinator runs on", async () => {
    setup({
      project: makeProject({
        id: "prj_1",
        coordinator: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: "claude-opus-5",
          effort: "high",
        },
      }),
    });
    await settled();

    expect(screen.getByTestId("coordinator-model").textContent).toBe("Opus 5");
    expect(screen.getByTestId("coordinator-effort").textContent).toBe("High");
  });

  test("choosing a model saves it to the project and hands the result to the live state", async () => {
    const project = makeProject({ id: "prj_1" });
    net.respond = () =>
      Response.json({
        project: { ...project, coordinator: { ...project.coordinator, model: "claude-opus-5" } },
      });
    const { stub } = setup({ project });
    await settled();

    fireEvent.pointerDown(screen.getByTestId("coordinator-model"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("coordinator-model-claude-opus-5"));
    await settled();

    expect(net.requests.at(-1)).toEqual({
      method: "PATCH",
      url: "/api/projects/prj_1",
      body: {
        coordinator: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: "claude-opus-5",
          effort: "low",
        },
      },
    });
    expect(stub.calls.adopted.at(-1)?.coordinator.model).toBe("claude-opus-5");
  });

  test("choosing an effort saves it, and 'Default effort' clears it", async () => {
    const project = makeProject({ id: "prj_1" });
    net.respond = () => Response.json({ project });
    setup({ project });
    await settled();

    fireEvent.pointerDown(screen.getByTestId("coordinator-effort"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("coordinator-effort-high"));
    await settled();
    expect(net.requests.at(-1)?.body).toEqual({
      coordinator: {
        provider: "claude-code",
        runtimeId: "claude-code",
        model: null,
        effort: "high",
      },
    });

    fireEvent.pointerDown(screen.getByTestId("coordinator-effort"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("coordinator-effort-default"));
    await settled();
    expect(net.requests.at(-1)?.body).toEqual({
      coordinator: { provider: "claude-code", runtimeId: "claude-code", model: null, effort: null },
    });
  });

  test("on default, the chip names the model the coordinator's last run reported, and the menu says Default (it)", async () => {
    setup({
      project: makeProject({
        id: "prj_1",
        coordinator: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: null,
          effort: null,
        },
        reportedRuntime: {
          coordinator: { model: "claude-opus-5-5", effort: null },
          thread: { model: null, effort: null },
        },
      }),
    });
    await settled();

    expect(screen.getByTestId("coordinator-model").textContent).toBe("Opus 5.5");
    expect(screen.getByTestId("coordinator-effort").textContent).toBe("Default effort");
    fireEvent.pointerDown(screen.getByTestId("coordinator-model"), { button: 0, ctrlKey: false });
    expect((await screen.findByTestId("coordinator-model-default")).textContent).toBe(
      "Default (Opus 5.5)",
    );
  });

  test("before any run the chips say Default model and Default effort", async () => {
    setup({
      project: makeProject({
        id: "prj_1",
        coordinator: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: null,
          effort: null,
        },
      }),
    });
    await settled();

    expect(screen.getByTestId("coordinator-model").textContent).toBe("Default model");
    expect(screen.getByTestId("coordinator-effort").textContent).toBe("Default effort");
  });
});
