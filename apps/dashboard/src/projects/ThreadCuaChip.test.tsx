import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installFakeLiveHost, makeLease } from "../live-view/test-utils";
import { setupDashboardDom } from "../test/setup-dom";
import { AT, makeThread } from "./test-utils";

setupDashboardDom();

const { act, cleanup, render, screen } = await import("@testing-library/react");
const { ThreadCard } = await import("./ThreadCard");
const { refreshLiveView, resetLiveViewForTests } = await import("../live-view/live-view-store");

const NOW = Date.parse(AT) + 5 * 60_000;
const originalFetch = globalThis.fetch;
const holder = { threadId: "thr_9", title: "Check the login page" };
const other = { threadId: "thr_8", title: "Fix the footer" };

beforeEach(() => {
  resetLiveViewForTests();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  resetLiveViewForTests();
  globalThis.fetch = originalFetch;
});

/** The card of thread `thr_1`, once the live view's status carried `lease`. */
const renderCard = async (lease: ReturnType<typeof makeLease>) => {
  installFakeLiveHost({ lease });
  await act(() => refreshLiveView());
  render(<ThreadCard now={NOW} thread={makeThread({ id: "thr_1" })} />);
};

const chip = () => screen.queryByTestId("thread-cua-chip");

describe("a thread card and the computer-use lease", () => {
  test("a thread in line says so, with its place", async () => {
    await renderCard(makeLease(holder, [other, { threadId: "thr_1", title: "Mine" }]));

    expect(chip()?.dataset.cuaState).toBe("waiting");
    expect(chip()?.textContent).toBe("Waiting for computer use (2nd in line)");
  });

  test("the next one in line is told it is next", async () => {
    await renderCard(makeLease(holder, [{ threadId: "thr_1", title: "Mine" }]));

    expect(chip()?.textContent).toBe("Waiting for computer use (next in line)");
  });

  test("the thread holding it says so quietly", async () => {
    await renderCard(makeLease({ threadId: "thr_1", title: "Mine" }, [other]));

    expect(chip()?.dataset.cuaState).toBe("holding");
    expect(chip()?.textContent).toBe("Using computer use");
  });

  test("a thread that neither holds nor waits shows nothing", async () => {
    await renderCard(makeLease(holder, [other]));

    expect(chip() === null).toBe(true);
  });
});
