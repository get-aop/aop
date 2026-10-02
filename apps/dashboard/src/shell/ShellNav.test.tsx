import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { makeState, stubLiveProjects } from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { ShellNav } = await import("./ShellNav");
const { navigate } = await import("./router");

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  const stub = stubLiveProjects(makeState([]));
  render(
    <ProjectsProvider live={stub.live}>
      <ShellNav current={null} />
    </ProjectsProvider>,
  );
});
afterEach(cleanup);

const isDisabled = (testId: string) => (screen.getByTestId(testId) as HTMLButtonElement).disabled;

describe("back and forward", () => {
  test("both are off on the first page the app showed, so back cannot leave the app", () => {
    expect(isDisabled("nav-back")).toBe(true);
    expect(isDisabled("nav-forward")).toBe(true);
  });

  test("back turns on once the app has gone somewhere, and forward once it has come back", () => {
    act(() => navigate("/projects/p1"));
    expect(isDisabled("nav-back")).toBe(false);
    expect(isDisabled("nav-forward")).toBe(true);

    // What the browser does on back: restores the earlier entry and says so.
    act(() => {
      window.history.replaceState({ aopHistoryIndex: 0 }, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(isDisabled("nav-back")).toBe(true);
    expect(isDisabled("nav-forward")).toBe(false);
  });

  test("a disabled button does not touch the browser's history", () => {
    const back = spyOn(window.history, "back");
    const forward = spyOn(window.history, "forward");
    try {
      fireEvent.click(screen.getByTestId("nav-back"));
      fireEvent.click(screen.getByTestId("nav-forward"));
      expect(back).not.toHaveBeenCalled();
      expect(forward).not.toHaveBeenCalled();
    } finally {
      back.mockRestore();
      forward.mockRestore();
    }
  });

  test("an enabled one goes through the browser's history", () => {
    act(() => navigate("/projects/p1"));
    const back = spyOn(window.history, "back").mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByTestId("nav-back"));
      expect(back).toHaveBeenCalledTimes(1);
    } finally {
      back.mockRestore();
    }
  });
});
