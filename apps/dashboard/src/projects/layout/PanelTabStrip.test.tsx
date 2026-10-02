import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { PanelTab, PanelTabStrip } = await import("./PanelTabStrip");
const { PANEL_TABS } = await import("./panel-tabs");
const { useOpenTabs } = await import("./use-open-tabs");
const { useRoute } = await import("../../shell/router");

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

/** The strip as the panel draws it: its active tab is the address's. */
const Strip = ({ onNewThread = () => {} }: { onNewThread?: () => void }) => {
  const route = useRoute();
  const active = route.name === "project-tab" ? route.tab : "threads";
  const openTabs = useOpenTabs("p1", active);
  return (
    <PanelTabStrip
      projectId="p1"
      active={active}
      openTabs={openTabs}
      waiting={0}
      onNewThread={onNewThread}
      trailing={null}
    />
  );
};

const openAddMenu = () =>
  fireEvent.pointerDown(screen.getByTestId("panel-add"), { button: 0, ctrlKey: false });

describe("the tab strip", () => {
  test("+ opens a tab, which stays on the strip; its x closes it and goes back to Threads", async () => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/projects/p1");
    render(<Strip />);
    expect(screen.queryByTestId("panel-tab-pull-requests")).toBeNull();

    openAddMenu();
    const item = await screen.findByTestId("panel-add-tab-pull-requests");
    expect(item.getAttribute("aria-checked")).toBe("false");
    act(() => fireEvent.click(item));

    expect(window.location.pathname).toBe("/projects/p1/pull-requests");
    expect(screen.getByTestId("panel-tab-pull-requests").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("panel-tab-threads").getAttribute("aria-selected")).toBe("false");

    // Going to Threads keeps the tab on the strip, as an icon.
    act(() => fireEvent.click(screen.getByTestId("panel-tab-threads")));
    expect(window.location.pathname).toBe("/projects/p1");
    expect(screen.getByTestId("panel-tab-pull-requests").getAttribute("aria-label")).toBe(
      "Pull requests",
    );
    expect(screen.queryByTestId("panel-tab-close-pull-requests")).toBeNull();

    act(() => fireEvent.click(screen.getByTestId("panel-tab-pull-requests")));
    act(() => fireEvent.click(screen.getByTestId("panel-tab-close-pull-requests")));
    expect(window.location.pathname).toBe("/projects/p1");
    expect(screen.queryByTestId("panel-tab-pull-requests")).toBeNull();
  });

  test("an address that names a tab puts it on the strip", () => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/projects/p1/pull-requests");
    render(<Strip />);
    expect(screen.getByTestId("panel-tab-pull-requests").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(JSON.parse(window.localStorage.getItem("aop:panel-tabs:v1:p1") ?? "[]")).toEqual([
      "pull-requests",
    ]);
  });

  test("+ › New thread calls for a new thread", async () => {
    window.history.pushState({}, "", "/projects/p1");
    let asked = 0;
    render(<Strip onNewThread={() => (asked += 1)} />);
    openAddMenu();
    fireEvent.click(await screen.findByTestId("panel-new-thread"));
    expect(asked).toBe(1);
  });
});
