import { afterEach } from "bun:test";
import type { Project } from "@aop/common";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { ConfirmationHost } from "../../components/ConfirmationHost";
import { RuntimeConfigurationProvider } from "../../hooks/runtime-configuration";
import { type ApiCall, mockApi } from "../../test/mock-api";
import { ProjectsProvider } from "../ProjectsProvider";
import { makeEntry, makeState, stubLiveProjects } from "../test-utils";

// The fake host of the test in flight. It goes after each test, so later test files (which
// run in the same process) reach the real `fetch` again.
let installed: ReturnType<typeof mockApi> | null = null;
afterEach(() => {
  installed?.restore();
  installed = null;
});

/**
 * A project settings section on a host that saves every PATCH as sent. Tests import this after
 * `setupDashboardDom()`, since testing-library needs the DOM first. `respond` answers any other
 * call, or a PATCH differently.
 */
export const renderSection = async (
  Section: ComponentType<{ project: Project }>,
  project: Project,
  respond: (call: ApiCall) => Response | Promise<Response> | undefined = () => undefined,
  options: { withRuntimes?: boolean } = {},
) => {
  installed?.restore();
  const api = mockApi(
    (call) =>
      respond(call) ??
      (call.method === "PATCH" && call.path === `/projects/${project.id}`
        ? Response.json({ project: { ...project, ...(call.body as object) } })
        : undefined),
  );
  installed = api;
  const stub = stubLiveProjects(makeState([makeEntry(project)]));
  const section = (current: Project, open: boolean) => (
    <ProjectsProvider live={stub.live}>
      {open ? <Section project={current} /> : null}
      <ConfirmationHost />
    </ProjectsProvider>
  );
  // With `withRuntimes`, the runtimes come from the host (`respond` answers their reads).
  const page = (current: Project, open = true) =>
    options.withRuntimes ? (
      <RuntimeConfigurationProvider>{section(current, open)}</RuntimeConfigurationProvider>
    ) : (
      section(current, open)
    );
  const view = render(page(project));
  // Async so the switch's size read (a microtask in the test DOM) lands inside act.
  await act(async () => {});
  return {
    api,
    stub,
    /** The section with the project the host now has. */
    rerender: (current: Project) => view.rerender(page(current)),
    /** The section closes (another section, × or Escape) while the rest of the page stays. */
    leave: () => view.rerender(page(project, false)),
  };
};

export const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

/** Opens a Radix select and picks an option by its name. */
export const choose = async (triggerTestId: string, option: string | RegExp) => {
  const trigger = screen.getByTestId(triggerTestId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

/** What a row's save state says: idle, saving, saved or error. */
export const savePhase = (rowControlTestId: string): string | null => {
  const row = screen.getByTestId(rowControlTestId).closest("[data-setting-row]");
  return (
    row?.querySelector("[data-testid=settings-save-state]")?.getAttribute("data-phase") ?? null
  );
};
