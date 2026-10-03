import { afterEach, describe, expect, test } from "bun:test";
import type { Project } from "@aop/common";
import type { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { answerRuntimes, makeRuntime, makeStatus } from "../runtime-test-utils";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, screen, waitFor } = await import("@testing-library/react");
const { ModelsSection } = await import("./ModelsSection");
const { choose, renderSection, savePhase } = await import("./section-test-utils");

let api: ReturnType<typeof mockApi> | undefined;

const renderModels = async (current: Project = makeProject({ id: "p1", name: "Checkout" })) => {
  const rendered = await renderSection(ModelsSection, current);
  api = rendered.api;
  return rendered;
};

afterEach(() => {
  cleanup();
  api?.restore();
});

describe("ModelsSection", () => {
  test("each choice saves at once, and only the row that changed says so", async () => {
    await renderModels();
    expect(screen.getByTestId("settings-coordinator-model").textContent).toBe("Default");
    expect(screen.getByTestId("settings-coordinator-effort").textContent).toContain("Low");
    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("High");

    await choose("settings-thread-model", "Sonnet 4.6");
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]).toEqual({
      method: "PATCH",
      path: "/projects/p1",
      body: {
        thread: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: "claude-sonnet-4-6",
          effort: "high",
        },
      },
    });
    await waitFor(() => expect(savePhase("settings-thread-model")).toBe("saved"));
    expect(savePhase("settings-thread-effort")).toBeNull();

    await choose("settings-coordinator-effort", "Default");
    await waitFor(() => expect(api?.writes()).toHaveLength(2));
    expect(api?.writes()[1]?.body).toEqual({
      coordinator: { provider: "claude-code", runtimeId: "claude-code", model: null, effort: null },
    });
  });

  test("each select is named for its role, since both groups have a Model and an Effort", async () => {
    await renderModels();
    for (const role of ["Coordinator", "Thread"]) {
      expect(screen.getByRole("combobox", { name: `${role} model` })).toBeTruthy();
      expect(screen.getByRole("combobox", { name: `${role} effort` })).toBeTruthy();
    }
  });

  test("a role on default names what its last run reported, and an explicit value stays as it is", async () => {
    await renderModels(
      makeProject({
        id: "p1",
        name: "Checkout",
        coordinator: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: null,
          effort: null,
        },
        thread: { provider: "claude-code", runtimeId: "claude-code", model: null, effort: "high" },
        reportedRuntime: {
          coordinator: { model: "claude-opus-5-5", effort: "low" },
          thread: { model: "claude-opus-5-5", effort: null },
        },
      }),
    );

    expect(screen.getByTestId("settings-coordinator-model").textContent).toBe("Default (Opus 5.5)");
    expect(screen.getByTestId("settings-coordinator-effort").textContent).toBe("Default (Low)");
    expect(screen.getByTestId("settings-thread-model").textContent).toBe("Default (Opus 5.5)");
    expect(screen.getByTestId("settings-thread-effort").textContent).toBe("High");
  });

  test("a thread keeps the model it started with, and the copy says so", async () => {
    await renderModels();
    expect(screen.getByTestId("settings-thread-runtime").textContent).toContain(
      "A new thread starts on these and keeps them",
    );
  });

  test("a model that does not take the current effort resets it to the default", async () => {
    const { rerender } = await renderModels(
      makeProject({
        id: "p1",
        name: "Checkout",
        thread: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: "claude-opus-5",
          effort: "max",
        },
      }),
    );
    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("Max");

    await choose("settings-thread-model", "Sonnet 4.6");

    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("Default");
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({
      thread: {
        provider: "claude-code",
        runtimeId: "claude-code",
        model: "claude-sonnet-4-6",
        effort: null,
      },
    });
    // Sonnet has no Max effort to choose either.
    rerender(
      makeProject({
        id: "p1",
        name: "Checkout",
        thread: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: "claude-sonnet-4-6",
          effort: null,
        },
      }),
    );
    fireEvent.pointerDown(screen.getByTestId("settings-thread-effort"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByTestId("settings-thread-effort"));
    await screen.findByRole("option", { name: "High" });
    expect(screen.queryByRole("option", { name: "Max" })).toBeNull();
  });
});

describe("ModelsSection runtimes", () => {
  const runtimes = {
    providers: [
      makeRuntime("claude-code", "Claude Code", [
        { model: "claude-opus-5-5", description: "Opus 5.5" },
      ]),
      makeRuntime("rt_wrap", "Wrapper", [
        { model: "glm-4.6", description: "GLM 4.6", levels: ["low"] },
        { model: "kimi-k2", description: "Kimi K2", levels: ["high"] },
      ]),
      makeRuntime("rt_gone", "Missing", [{ model: "m" }]),
    ],
    statuses: [
      makeStatus("claude-code"),
      makeStatus("rt_wrap"),
      makeStatus("rt_gone", "The command `/opt/bin/rt_gone` was not found on this host's PATH."),
    ],
  };

  const renderWithRuntimes = async (
    project: Project = makeProject({ id: "p1", name: "Checkout" }),
  ) => {
    const rendered = await renderSection(ModelsSection, project, answerRuntimes(runtimes), {
      withRuntimes: true,
    });
    api = rendered.api;
    await waitFor(() =>
      expect(screen.getByTestId("settings-thread-runtime-select").textContent).toBe("Claude Code"),
    );
    return rendered;
  };

  test("lists every runtime; one that is not ready shows why and cannot be picked", async () => {
    await renderWithRuntimes();
    const trigger = screen.getByTestId("settings-thread-runtime-select");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const missing = await screen.findByTestId("settings-thread-runtime-select-option-rt_gone");
    expect(missing.getAttribute("data-disabled") !== null).toBe(true);
    expect(missing.textContent).toContain("was not found on this host's PATH");
    const wrapper = screen.getByTestId("settings-thread-runtime-select-option-rt_wrap");
    expect(wrapper.getAttribute("data-disabled") === null).toBe(true);
  });

  test("picking a runtime saves it with the model back on default, and the models become its own", async () => {
    const { rerender } = await renderWithRuntimes();

    await choose("settings-thread-runtime-select", /Wrapper/);
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({
      // High is not an effort the wrapper's default model (GLM 4.6) takes, so it goes back to default.
      thread: { provider: "claude-code", runtimeId: "rt_wrap", model: null, effort: null },
    });

    rerender(
      makeProject({
        id: "p1",
        name: "Checkout",
        thread: { provider: "claude-code", runtimeId: "rt_wrap", model: null, effort: null },
      }),
    );
    const trigger = screen.getByTestId("settings-thread-model");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Default", "GLM 4.6", "Kimi K2"]);
  });

  test("a project on a runtime that is not ready says so under the picker", async () => {
    await renderWithRuntimes(
      makeProject({
        id: "p1",
        name: "Checkout",
        coordinator: { provider: "claude-code", runtimeId: "rt_gone", model: null, effort: null },
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("settings-coordinator-runtime-not-ready").textContent).toContain(
        "was not found",
      ),
    );
  });
});
