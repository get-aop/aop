import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Thread } from "@aop/common";
import { toast } from "sonner";
import { setupDashboardDom } from "../../../test/setup-dom";
import { makeThread } from "../../test-utils";
import { hostError, json, mockHost } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ReviewQueue } = await import("./ReviewQueue");
const {
  addThreadReviewComment,
  getThreadReviewQueue,
  resetThreadReviewQueueCacheForTests,
  useThreadReviewQueue,
} = await import("./review-queue");
const { serializeReviewMessage } = await import("./review-serializer");

const THREAD_ID = "thr_1";

let host: ReturnType<typeof mockHost>;
let success: ReturnType<typeof spyOn<typeof toast, "success">>;

beforeEach(() => {
  window.localStorage.clear();
  resetThreadReviewQueueCacheForTests();
  host = mockHost();
  host.respondWith(() => json({ thread: makeThread({ id: THREAD_ID }) }, 201));
  success = spyOn(toast, "success").mockImplementation(() => "");
});

afterEach(() => {
  cleanup();
  host.restore();
  success.mockRestore();
});

const comment = (path: string, note: string, overrides = {}) => ({
  path,
  lineType: "add" as const,
  oldNo: null,
  newNo: 4,
  excerpt: "const b = 3;",
  note,
  ...overrides,
});

const queueTwo = () => {
  addThreadReviewComment(THREAD_ID, comment("src/a.ts", "why 3?"));
  addThreadReviewComment(
    THREAD_ID,
    comment("src/b.ts", "restore this", {
      lineType: "del",
      oldNo: 12,
      newNo: null,
      excerpt: "old code",
    }),
  );
};

const Harness = ({ thread, onSent }: { thread: Thread; onSent: () => void }) => {
  const comments = useThreadReviewQueue(thread.id);
  return <ReviewQueue thread={thread} comments={comments} onSent={onSent} />;
};

const renderQueue = (thread: Thread = makeThread({ id: THREAD_ID, status: "idle" })) => {
  const onSent = mock(() => {});
  render(<Harness thread={thread} onSent={onSent} />);
  return onSent;
};

const send = () => fireEvent.click(screen.getByTestId("review-send"));

describe("the queued comments", () => {
  test("nothing is drawn while there are none", () => {
    renderQueue();

    expect(screen.queryByTestId("review-queue-panel")).toBeNull();
  });

  test("each comment is a card with its place, the line it is on and what was said", () => {
    queueTwo();
    renderQueue();

    const cards = screen.getAllByTestId("review-queue-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("src/a.ts:4");
    expect(cards[0]?.textContent).toContain("const b = 3;");
    expect(cards[0]?.textContent).toContain("why 3?");
    expect(cards[1]?.textContent).toContain("src/b.ts:old line 12");
    expect(cards[1]?.textContent).toContain("restore this");
  });

  test("a card can be edited, and the new note is the one that is kept", () => {
    queueTwo();
    renderQueue();

    fireEvent.click(screen.getByLabelText("Edit review comment on src/a.ts"));
    fireEvent.change(screen.getByLabelText("Review comment"), {
      target: { value: "actually fine" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(screen.getAllByTestId("review-queue-card")[0]?.textContent).toContain("actually fine");
    expect(getThreadReviewQueue(THREAD_ID).map((entry) => entry.note)).toEqual([
      "actually fine",
      "restore this",
    ]);
  });

  test("a card can be removed, and the last one takes the panel with it", () => {
    queueTwo();
    renderQueue();

    fireEvent.click(screen.getByLabelText("Remove review comment on src/a.ts"));
    expect(screen.getAllByTestId("review-queue-card")).toHaveLength(1);
    expect(getThreadReviewQueue(THREAD_ID).map((entry) => entry.path)).toEqual(["src/b.ts"]);

    fireEvent.click(screen.getByLabelText("Remove review comment on src/b.ts"));
    expect(screen.queryByTestId("review-queue-panel")).toBeNull();
    expect(getThreadReviewQueue(THREAD_ID)).toEqual([]);
  });

  test("the button counts them: one comment, or several", () => {
    addThreadReviewComment(THREAD_ID, comment("src/a.ts", "why 3?"));
    renderQueue();
    expect(screen.getByTestId("review-send").textContent).toContain("Send 1 comment to the thread");

    cleanup();
    window.localStorage.clear();
    resetThreadReviewQueueCacheForTests();
    queueTwo();
    renderQueue();
    expect(screen.getByTestId("review-send").textContent).toContain(
      "Send 2 comments to the thread",
    );
  });
});

describe("sending them", () => {
  test("posts one message the thread can act on, then clears the queue and says so", async () => {
    queueTwo();
    const expected = serializeReviewMessage(getThreadReviewQueue(THREAD_ID), "");
    const onSent = renderQueue();

    send();

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(host.requests).toEqual([
      { method: "POST", url: `/api/threads/${THREAD_ID}/messages`, body: { text: expected } },
    ]);
    expect(expected).toContain("Review comments on the current diff:");
    expect(expected).toContain("### src/a.ts:4");
    expect(expected).toContain("### src/b.ts:old line 12");
    expect(getThreadReviewQueue(THREAD_ID)).toEqual([]);
    expect(screen.queryByTestId("review-queue-panel")).toBeNull();
    expect(success).toHaveBeenCalledWith("Sent 2 review comments to the thread");
  });

  test("one comment is reported in the singular", async () => {
    addThreadReviewComment(THREAD_ID, comment("src/a.ts", "why 3?"));
    const onSent = renderQueue();

    send();

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(success).toHaveBeenCalledWith("Sent 1 review comment to the thread");
  });

  test("the button waits while the message is on its way, so it cannot be sent twice", async () => {
    queueTwo();
    let release: (response: Response) => void = () => {};
    host.respondWith(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    renderQueue();

    send();

    await waitFor(() =>
      expect(screen.getByTestId("review-send").hasAttribute("disabled")).toBe(true),
    );
    send();
    expect(host.requests).toHaveLength(1);

    await act(async () => release(json({ thread: makeThread({ id: THREAD_ID }) }, 201)));
    await waitFor(() => expect(screen.queryByTestId("review-queue-panel")).toBeNull());
  });

  test("a send the host refuses keeps every comment, says why, and can be tried again", async () => {
    queueTwo();
    host.respondWith(() =>
      hostError(409, "THREAD_BUSY", "The thread is busy: its pull request is landing"),
    );
    const onSent = renderQueue();

    send();

    const failure = await screen.findByTestId("review-send-error");
    expect(failure.textContent).toBe("The thread is busy: its pull request is landing");
    expect(failure.getAttribute("role")).toBe("alert");
    expect(onSent).not.toHaveBeenCalled();
    expect(getThreadReviewQueue(THREAD_ID)).toHaveLength(2);
    expect(screen.getAllByTestId("review-queue-card")).toHaveLength(2);
    expect(success).not.toHaveBeenCalled();
    expect(screen.getByTestId("review-send").hasAttribute("disabled")).toBe(false);

    host.respondWith(() => json({ thread: makeThread({ id: THREAD_ID }) }, 201));
    send();

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("review-send-error")).toBeNull();
    expect(getThreadReviewQueue(THREAD_ID)).toEqual([]);
  });
});

describe("a thread whose pull request is merging", () => {
  test("sends nothing, and says why", () => {
    queueTwo();
    renderQueue(makeThread({ id: THREAD_ID, status: "landing" }));

    const button = screen.getByTestId("review-send");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("review-queue-panel").textContent).toContain(
      "The thread takes no message while its pull request merges.",
    );
    fireEvent.click(button);
    expect(host.requests).toHaveLength(0);
  });

  test("an idle thread shows no such note", () => {
    queueTwo();
    renderQueue();

    expect(screen.getByTestId("review-queue-panel").textContent).not.toContain("takes no message");
  });
});
