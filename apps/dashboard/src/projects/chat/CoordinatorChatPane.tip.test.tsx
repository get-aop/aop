import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { cleanup, screen } = await import("@testing-library/react");
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

describe("the usage tip in the coordinator chat", () => {
  test("sits right above the box on an active project", async () => {
    setup();
    await settled();

    const tip = screen.getByTestId("usage-tip");
    expect(tip.nextElementSibling).toBe(screen.getByTestId("composer"));
  });

  test("gives way to the paused notice on a paused project", async () => {
    setup({ project: makeProject({ id: "prj_1", status: "paused" }) });
    await settled();

    expect(screen.queryByTestId("usage-tip")).toBeNull();
    expect(screen.getByTestId("chat-closed-notice").getAttribute("data-status")).toBe("paused");
  });

  test("stays away once this browser has closed it", async () => {
    window.localStorage.setItem("aop:usage-tip-dismissed:v1", "true");
    setup();
    await settled();

    expect(screen.queryByTestId("usage-tip")).toBeNull();
    expect(screen.getByTestId("composer")).toBeTruthy();
  });
});
