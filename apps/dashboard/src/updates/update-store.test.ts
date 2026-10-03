import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeHost, makeUpdateStatus } from "./test-utils";

setupDashboardDom();

const store = await import("./update-store");

const originalFetch = globalThis.fetch;
const reload = mock(() => {});
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The probe interval is short so the test waits for real polls instead of faking the clock.
beforeEach(() => {
  reload.mockClear();
  store.resetUpdatesForTests({ onHostBack: reload, pollMs: 10, giveUpMs: 400 });
  window.sessionStorage.clear();
});

afterEach(() => {
  store.resetUpdatesForTests();
  globalThis.fetch = originalFetch;
});

describe("update store", () => {
  test("refreshing keeps what the host reports, and a host that stops answering leaves it in place", async () => {
    installFakeHost();
    await store.refreshUpdates();
    expect((await snapshot()).status?.latest).toBe("0.10.0");

    globalThis.fetch = mock(async () => {
      throw new TypeError("down");
    }) as unknown as typeof fetch;
    await store.refreshUpdates();
    expect((await snapshot()).status?.latest).toBe("0.10.0");
  });

  test("waits through the restart, then reloads once the host reports the new release", async () => {
    const host = installFakeHost();
    await store.refreshUpdates();

    await store.startUpdate();
    expect(host.calls).toContain("POST /updates/apply");
    expect((await snapshot()).target).toBe("0.10.0");

    host.health = null;
    await settle(60);
    host.health = { version: "0.9.51" };
    await settle(60);
    expect(reload).not.toHaveBeenCalled();

    host.health = { version: "0.10.0+abc1234" };
    await settle(60);
    expect(reload).toHaveBeenCalledTimes(1);
    // The reloaded page says so once: "Host soulf updated to 0.10.0".
    expect(JSON.parse(window.sessionStorage.getItem("aop:host-updated:v1") ?? "null")).toEqual({
      version: "0.10.0",
      hostName: "soulf",
      releaseUrl: "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
    });
  });

  test("update when they finish asks the host to queue it, and waits for no restart yet", async () => {
    const host = installFakeHost({ queues: true });
    await store.refreshUpdates();

    await store.startUpdate("idle");

    expect(host.calls).toContain("POST /updates/apply");
    const state = await snapshot();
    expect(state.target).toBeNull();
    expect(state.sending).toBe(false);
    expect(host.calls.filter((call) => call === "GET /health")).toHaveLength(0);
  });

  test("cancelling a queued update asks the host to drop it and reads the status again", async () => {
    const host = installFakeHost();
    await store.refreshUpdates();

    await store.cancelQueued();

    expect(host.calls.slice(-2)).toEqual(["DELETE /updates/apply", "GET /updates"]);
  });

  test("a refused update reports why and waits for nothing", async () => {
    const host = installFakeHost({ applyStatus: 409 });
    await store.refreshUpdates();

    await store.startUpdate();

    const state = await snapshot();
    expect(state.target).toBeNull();
    expect(state.error).toBe("Nothing to update");
    expect(host.calls.filter((call) => call === "GET /health")).toHaveLength(0);
  });

  test("stops waiting and shows why when the host comes back on the old release after a rollback", async () => {
    const host = installFakeHost();
    await store.refreshUpdates();
    await store.startUpdate();

    host.status = makeUpdateStatus({
      state: "failed",
      updateError: "AOP 0.10.0 did not start. Rolled back to 0.9.51.",
    });
    await settle(60);

    const state = await snapshot();
    expect(state.target).toBeNull();
    expect(state.status?.updateError).toBe("AOP 0.10.0 did not start. Rolled back to 0.9.51.");
    expect(reload).not.toHaveBeenCalled();
  });

  test("gives up when the host never comes back on the release", async () => {
    installFakeHost();
    await store.refreshUpdates();
    await store.startUpdate();

    await settle(500);

    const state = await snapshot();
    expect(state.target).toBeNull();
    expect(state.error).toBe("The host did not come back on 0.10.0.");
    expect(reload).not.toHaveBeenCalled();
  });

  test("a page opened while another device updates the host starts waiting for it", async () => {
    installFakeHost({ status: makeUpdateStatus({ state: "updating" }) });

    await store.refreshUpdates();

    expect((await snapshot()).target).toBe("0.10.0");
  });
});

const snapshot = async () => {
  const { renderHook } = await import("@testing-library/react");
  const { result, unmount } = renderHook(() => store.useUpdates());
  const state = result.current;
  unmount();
  return state;
};
