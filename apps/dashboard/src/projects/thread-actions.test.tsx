import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { setupDashboardDom } from "../test/setup-dom";
import { makeThread } from "./test-utils";
import { hostError, json, mockHost } from "./thread/test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ConfirmationHost } = await import("../components/ConfirmationHost");
const { threadActions } = await import("./thread-actions");

const thread = makeThread({ id: "thr_1", projectId: "prj_1", title: "Fix login" });
let host: ReturnType<typeof mockHost>;
let failure: ReturnType<typeof spyOn<typeof toast, "error">>;

beforeEach(() => {
  window.history.pushState({}, "", "/");
  host = mockHost();
  failure = spyOn(toast, "error").mockImplementation(() => "");
});

afterEach(() => {
  cleanup();
  host.restore();
  failure.mockRestore();
});

describe("the calls a thread's actions make", () => {
  test("stop, resume and resolve post to their own route with no body", async () => {
    host.respondWith(() => json({ thread }));

    await threadActions.stop(thread);
    await threadActions.resume(thread);
    await threadActions.resolve(thread);

    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/stop", body: undefined },
      { method: "POST", url: "/api/threads/thr_1/resume", body: undefined },
      { method: "POST", url: "/api/threads/thr_1/resolve", body: undefined },
    ]);
    expect(failure).not.toHaveBeenCalled();
  });

  test("steering posts the text to the thread's messages, and answering posts it to reply", async () => {
    host.respondWith(() => json({ thread }));

    expect(await threadActions.steer(thread, "use the new API")).toEqual({ ok: true });
    expect(await threadActions.reply(thread, "Postgres")).toEqual({ ok: true });

    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/messages", body: { text: "use the new API" } },
      { method: "POST", url: "/api/threads/thr_1/reply", body: { text: "Postgres" } },
    ]);
  });

  test("a thread id that needs escaping is escaped in the address", async () => {
    host.respondWith(() => json({ thread }));

    await threadActions.stop({ ...thread, id: "a/b" });

    expect(host.requests[0]?.url).toBe("/api/threads/a%2Fb/stop");
  });
});

describe("when the host refuses", () => {
  test("a failed stop, resume or resolve is a toast with the host's sentence, and nothing throws", async () => {
    host.respondWith(() => hostError(409, "THREAD_BUSY", "The thread is busy"));

    await threadActions.stop(thread);
    await threadActions.resume(thread);
    await threadActions.resolve(thread);

    expect(failure.mock.calls.map(([message]) => message)).toEqual([
      "The thread is busy",
      "The thread is busy",
      "The thread is busy",
    ]);
  });

  test("a message the host refuses comes back as the reason, and no toast is raised", async () => {
    host.respondWith(() => hostError(409, "NOT_WAITING", "The thread is not waiting on an answer"));

    expect(await threadActions.reply(thread, "Postgres")).toEqual({
      ok: false,
      error: "The thread is not waiting on an answer",
    });
    expect(await threadActions.steer(thread, "hello")).toEqual({
      ok: false,
      error: "The thread is not waiting on an answer",
    });
    expect(failure).not.toHaveBeenCalled();
  });

  test("a host that cannot be reached is still a sentence", async () => {
    host.respondWith(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await threadActions.steer(thread, "hello")).toEqual({
      ok: false,
      error: "Failed to fetch",
    });
  });
});

describe("removing a thread", () => {
  const removeAndAnswer = async (button: "Cancel" | "Delete thread") => {
    render(<ConfirmationHost />);
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = threadActions.remove(thread);
    });
    await screen.findByText(/Delete “Fix login”\?/);
    fireEvent.click(screen.getByText(button));
    await done;
  };

  test("nothing is deleted until the person confirms, and cancelling sends nothing", async () => {
    await removeAndAnswer("Cancel");

    expect(host.requests).toEqual([]);
  });

  test("with no confirmation dialog mounted, nothing is deleted either", async () => {
    await threadActions.remove(thread);

    expect(host.requests).toEqual([]);
  });

  test("a confirmed delete sends DELETE, and leaves the thread when it is the one open", async () => {
    window.history.pushState({}, "", "/projects/prj_1/threads/thr_1");
    host.respondWith(() => new Response(null, { status: 204 }));

    await removeAndAnswer("Delete thread");

    expect(host.requests).toEqual([
      { method: "DELETE", url: "/api/threads/thr_1", body: undefined },
    ]);
    expect(window.location.pathname).toBe("/projects/prj_1");
  });

  test("deleting a thread that is not the open one leaves the address alone", async () => {
    window.history.pushState({}, "", "/projects/prj_1/threads/thr_other");
    host.respondWith(() => new Response(null, { status: 204 }));

    await removeAndAnswer("Delete thread");

    expect(host.requests).toHaveLength(1);
    expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_other");
  });

  test("deleting from the project home leaves the address alone", async () => {
    window.history.pushState({}, "", "/projects/prj_1");
    host.respondWith(() => new Response(null, { status: 204 }));

    await removeAndAnswer("Delete thread");

    expect(host.requests).toHaveLength(1);
    expect(window.location.pathname).toBe("/projects/prj_1");
  });

  test("a delete the host refuses is a toast, and the person stays where they are", async () => {
    window.history.pushState({}, "", "/projects/prj_1/threads/thr_1");
    host.respondWith(() => hostError(409, "SESSION_BUSY", "Session thr_1 is still running"));

    await removeAndAnswer("Delete thread");

    await waitFor(() => expect(failure).toHaveBeenCalledWith("Session thr_1 is still running"));
    expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_1");
  });
});
