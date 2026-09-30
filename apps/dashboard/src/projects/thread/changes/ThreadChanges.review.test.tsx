import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../../test/setup-dom";
import { makeThread } from "../../test-utils";
import { json, mockHost } from "../test-utils";
import { DiffHarness as Harness, modified, serveDiff, THREAD_ID } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { getThreadReviewQueue, resetThreadReviewQueueCacheForTests } = await import(
  "./review-queue"
);

let host: ReturnType<typeof mockHost>;

const serve = (files: Parameters<typeof serveDiff>[1]) => serveDiff(host, files);

beforeEach(() => {
  window.localStorage.clear();
  resetThreadReviewQueueCacheForTests();
  host = mockHost();
});

afterEach(() => {
  cleanup();
  host.restore();
});

describe("review comments", () => {
  const commentButton = (label: string) => screen.findByLabelText(label);

  test("the gutter button opens an editor; Cancel and Escape close it without queueing", async () => {
    serve([modified]);
    render(<Harness />);
    const button = await commentButton("Comment on src/a.ts line 2");

    fireEvent.click(button);
    expect(screen.getByTestId("diff-comment-editor")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("diff-comment-editor")).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("Review comment"), { key: "Escape" });
    expect(screen.queryByTestId("diff-comment-editor")).toBeNull();
    expect(getThreadReviewQueue(THREAD_ID)).toHaveLength(0);
    expect(screen.queryByTestId("review-queue-panel")).toBeNull();
  });

  test("Add queues the comment with the line it is on, marks the line and offers to send it", async () => {
    serve([modified]);
    render(<Harness />);
    const button = await commentButton("Comment on src/a.ts line 2");
    expect(button.getAttribute("data-commented")).toBeNull();

    fireEvent.click(button);
    fireEvent.change(screen.getByLabelText("Review comment"), {
      target: { value: "prefer a constant" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(screen.queryByTestId("diff-comment-editor")).toBeNull();
    expect(getThreadReviewQueue(THREAD_ID)).toHaveLength(1);
    expect(getThreadReviewQueue(THREAD_ID)[0]).toMatchObject({
      path: "src/a.ts",
      lineType: "add",
      oldNo: null,
      newNo: 2,
      excerpt: "const b = 3;",
      note: "prefer a constant",
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText("Comment on src/a.ts line 2").getAttribute("data-commented"),
      ).toBe("true"),
    );
    expect(screen.getByTestId("review-send").textContent).toContain("Send 1 comment to the thread");
  });

  test("Cmd+Enter saves from the editor", async () => {
    serve([modified]);
    render(<Harness />);
    fireEvent.click(await commentButton("Comment on src/a.ts line 1"));

    const editor = screen.getByLabelText("Review comment");
    fireEvent.change(editor, { target: { value: "context note" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });

    expect(getThreadReviewQueue(THREAD_ID)).toHaveLength(1);
    expect(getThreadReviewQueue(THREAD_ID)[0]?.lineType).toBe("context");
  });

  test("a deleted line is commented on by its old number", async () => {
    serve([modified]);
    render(<Harness />);
    fireEvent.click(await commentButton("Comment on src/a.ts old line 2"));

    fireEvent.change(screen.getByLabelText("Review comment"), { target: { value: "keep it" } });
    fireEvent.click(screen.getByText("Add"));

    expect(getThreadReviewQueue(THREAD_ID)[0]).toMatchObject({
      lineType: "del",
      oldNo: 2,
      newNo: null,
      excerpt: "const b = 2;",
    });
  });

  test("sending them steers the thread and takes the person back to the conversation", async () => {
    serve([modified]);
    const onReviewSent = mock(() => {});
    render(<Harness onReviewSent={onReviewSent} />);
    fireEvent.click(await commentButton("Comment on src/a.ts line 2"));
    fireEvent.change(screen.getByLabelText("Review comment"), { target: { value: "why 3?" } });
    fireEvent.click(screen.getByText("Add"));

    host.respondWith(() => json({ thread: makeThread({ id: THREAD_ID }) }, 201));
    fireEvent.click(screen.getByTestId("review-send"));

    await waitFor(() => expect(onReviewSent).toHaveBeenCalledTimes(1));
    expect(host.to(`/api/threads/${THREAD_ID}/messages`, "POST")).toHaveLength(1);
    expect(host.to(`/api/threads/${THREAD_ID}/messages`, "POST")[0]?.body).toMatchObject({
      text: expect.stringContaining("### src/a.ts:2"),
    });
    expect(getThreadReviewQueue(THREAD_ID)).toEqual([]);
  });
});
