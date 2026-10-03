import { afterEach, describe, expect, test } from "bun:test";
import type { Project, Thread } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ThreadRuntimeChips } = await import("./ThreadRuntimeChips");

afterEach(cleanup);

const onDefault = makeThread({
  projectId: "p1",
  runtime: { provider: "claude-code", runtimeId: "claude-code", model: null, effort: null },
});

const renderChips = (project: Project, thread: Thread = onDefault) => {
  const stub = stubLiveProjects(makeState([makeEntry(project)]));
  render(
    <ProjectsProvider live={stub.live}>
      <ThreadRuntimeChips thread={thread} />
    </ProjectsProvider>,
  );
};

const chips = () => [
  screen.getByTestId("thread-model").textContent,
  screen.getByTestId("thread-effort").textContent,
];

describe("ThreadRuntimeChips", () => {
  test("a thread on default says so until a thread run of the project reported a model", () => {
    renderChips(makeProject({ id: "p1" }));
    expect(chips()).toEqual(["Default model", "Default effort"]);
  });

  test("then it names the model the run reported, as Claude Code picked it", () => {
    renderChips(
      makeProject({
        id: "p1",
        reportedRuntime: {
          coordinator: { model: null, effort: null },
          thread: { model: "claude-opus-5-5", effort: null },
        },
      }),
    );
    expect(chips()).toEqual(["Opus 5.5", "Default effort"]);
  });

  test("a thread that names its model and effort shows them, whatever was reported", () => {
    renderChips(
      makeProject({
        id: "p1",
        reportedRuntime: {
          coordinator: { model: null, effort: null },
          thread: { model: "claude-opus-5-5", effort: "low" },
        },
      }),
      makeThread({
        projectId: "p1",
        runtime: {
          provider: "claude-code",
          runtimeId: "claude-code",
          model: "claude-sonnet-4-6",
          effort: "high",
        },
      }),
    );
    expect(chips()).toEqual(["Sonnet 4.6", "High"]);
  });
});
