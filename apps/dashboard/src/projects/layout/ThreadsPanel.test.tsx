import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { PANEL_TABS, PanelTab } = await import("./ThreadsPanel");

afterEach(cleanup);

const THREADS = PANEL_TABS[0];

describe("a panel tab", () => {
  test("the one showing has its icon and its name", () => {
    render(<PanelTab tab={THREADS} active projectId="p1" waiting={0} />);

    const tab = screen.getByTestId("panel-tab-threads");
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.textContent).toBe("Threads");
    expect(tab.querySelector("svg")).not.toBeNull();
    expect(tab.getAttribute("href")).toBe("/projects/p1");
  });

  test("any other has only its icon, with its name in the tooltip and for a screen reader", () => {
    render(<PanelTab tab={THREADS} active={false} projectId="p1" waiting={0} />);

    const tab = screen.getByTestId("panel-tab-threads");
    expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(tab.textContent).toBe("");
    expect(tab.getAttribute("aria-label")).toBe("Threads");
    expect(tab.getAttribute("title")).toBe("Threads");
    expect(tab.querySelector("svg")).not.toBeNull();
  });

  test("counts the threads waiting on the person", () => {
    render(<PanelTab tab={THREADS} active projectId="p1" waiting={2} />);

    expect(screen.getByTestId("project-tab-waiting").textContent).toBe("2");
  });
});
