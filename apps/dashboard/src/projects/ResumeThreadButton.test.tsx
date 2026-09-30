import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { ThreadStatus } from "@aop/common";
import { toast } from "sonner";
import { setupDashboardDom } from "../test/setup-dom";
import { makeThread } from "./test-utils";
import { hostError, json, mockHost } from "./thread/test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ResumeThreadButton } = await import("./ResumeThreadButton");

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

describe("ResumeThreadButton", () => {
  test("is offered to a rate-limited thread and to no other", () => {
    const statuses: ThreadStatus[] = [
      "waiting-on-you",
      "working",
      "queued",
      "ready-for-review",
      "landing",
      "idle",
      "resolved",
    ];
    for (const status of statuses) {
      const { unmount } = render(<ResumeThreadButton thread={makeThread({ status })} />);
      expect(screen.queryByTestId("thread-card-resume")).toBeNull();
      unmount();
    }

    render(<ResumeThreadButton thread={makeThread({ status: "rate-limited" })} />);
    expect(screen.getByTestId("thread-card-resume").textContent).toContain("Resume now");
  });

  test("asks the host to end the wait now", async () => {
    host.respondWith(() => json({ thread: makeThread({ id: "thr 1", status: "working" }) }));
    render(<ResumeThreadButton thread={makeThread({ id: "thr 1", status: "rate-limited" })} />);

    fireEvent.click(screen.getByTestId("thread-card-resume"));

    await waitFor(() => expect(host.to("/api/threads/thr%201/resume", "POST")).toHaveLength(1));
    expect(failure).not.toHaveBeenCalled();
  });

  test("sits above the card's link so a click reaches it, and takes the caller's classes", () => {
    render(
      <ResumeThreadButton
        thread={makeThread({ status: "rate-limited" })}
        className="mt-1 self-start"
      />,
    );

    const button = screen.getByTestId("thread-card-resume");
    expect(button.className).toContain("relative");
    expect(button.className).toContain("z-10");
    expect(button.className).toContain("self-start");
  });

  test("a wait the host will not end is a toast with the host's own sentence", async () => {
    host.respondWith(() =>
      hostError(409, "NOT_RATE_LIMITED", "The thread is not waiting on a rate limit"),
    );
    render(<ResumeThreadButton thread={makeThread({ status: "rate-limited" })} />);

    fireEvent.click(screen.getByTestId("thread-card-resume"));

    await waitFor(() =>
      expect(failure).toHaveBeenCalledWith("The thread is not waiting on a rate limit"),
    );
  });
});
