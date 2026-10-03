import { afterEach, describe, expect, test } from "bun:test";
import type { Project } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { answerRuntimes, makeRuntime, makeStatus } from "../runtime-test-utils";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { RuntimeConfigurationProvider } = await import("../../hooks/runtime-configuration");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { CoordinatorChips } = await import("./CoordinatorChips");

let api: ReturnType<typeof mockApi> | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
});

const runtimes = {
  providers: [
    makeRuntime("claude-code", "Claude Code", [
      { model: "claude-opus-5-5", description: "Opus 5.5" },
    ]),
    makeRuntime("rt_wrap", "Wrapper", [{ model: "glm-4.6", description: "GLM 4.6" }]),
    makeRuntime("rt_gone", "Missing", [{ model: "m" }]),
  ],
  statuses: [
    makeStatus("claude-code"),
    makeStatus("rt_wrap"),
    makeStatus("rt_gone", "The command `/opt/bin/rt_gone` was not found on this host's PATH."),
  ],
};

const renderChips = async (project: Project) => {
  api = mockApi(
    (call) =>
      answerRuntimes(runtimes)(call) ??
      (call.method === "PATCH"
        ? Response.json({ project: { ...project, ...(call.body as object) } })
        : undefined),
  );
  const stub = stubLiveProjects(makeState([makeEntry(project)]));
  render(
    <RuntimeConfigurationProvider>
      <ProjectsProvider live={stub.live}>
        <CoordinatorChips project={project} />
      </ProjectsProvider>
    </RuntimeConfigurationProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("coordinator-runtime").textContent).not.toBe("Runtime"),
  );
};

const open = async (testId: string) => {
  fireEvent.pointerDown(screen.getByTestId(testId), { button: 0, ctrlKey: false });
  await screen.findByTestId(`${testId}-menu`);
};

describe("the coordinator's runtime chip", () => {
  test("names the runtime, and the model chip lists that runtime's models", async () => {
    await renderChips(
      makeProject({
        id: "prj_1",
        coordinator: {
          provider: "claude-code",
          runtimeId: "rt_wrap",
          model: "glm-4.6",
          effort: null,
        },
      }),
    );

    expect(screen.getByTestId("coordinator-runtime").textContent).toBe("Wrapper");
    expect(screen.getByTestId("coordinator-model").textContent).toBe("GLM 4.6");
    await open("coordinator-model");
    expect(screen.queryByTestId("coordinator-model-glm-4.6") !== null).toBe(true);
    expect(screen.queryByTestId("coordinator-model-claude-opus-5-5") === null).toBe(true);
  });

  test("switching runtime saves it with the model back on default; one not ready is not offered", async () => {
    await renderChips(makeProject({ id: "prj_1" }));
    await open("coordinator-runtime");

    const missing = screen.getByTestId("coordinator-runtime-rt_gone");
    expect(missing.getAttribute("data-disabled") !== null).toBe(true);
    expect(missing.textContent).toContain("was not found");

    fireEvent.click(screen.getByTestId("coordinator-runtime-rt_wrap"));
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({
      coordinator: { provider: "claude-code", runtimeId: "rt_wrap", model: null, effort: "low" },
    });
  });
});
