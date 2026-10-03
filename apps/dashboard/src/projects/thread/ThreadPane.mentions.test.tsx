import { afterEach, beforeEach, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { userMessage } from "../chat/test-utils";
import { makeThread } from "../test-utils";
import { mockHost } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, screen, within } = await import("@testing-library/react");
const { flush, setupPane } = await import("./pane-test-harness");

let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/prj_1/threads/thr_1");
  host = mockHost();
});

afterEach(() => {
  cleanup();
  host.restore();
});

const input = () => screen.getByTestId("composer-input") as HTMLTextAreaElement;
const type = (text: string) =>
  fireEvent.change(input(), {
    target: { value: text, selectionStart: text.length, selectionEnd: text.length },
  });

test("a thread's composer mentions the project's other threads, and sends the thread link", async () => {
  await setupPane(host, {
    thread: makeThread({ id: "thr_1", title: "Fix checkout", status: "idle" }),
    others: [
      makeThread({ id: "thr_2", title: "Payments API", description: "Add the refunds endpoint" }),
    ],
    messages: [userMessage("u0", 1, { threadId: "thr_1" })],
  });
  await screen.findByTestId("user-message");

  type("Match @refunds");
  const options = screen.getAllByTestId("mention-option");
  // The thread itself is not offered.
  expect(options.map((option) => option.getAttribute("data-thread-id"))).toEqual(["thr_2"]);

  fireEvent.keyDown(input(), { key: "Enter" });
  expect(input().value).toBe("Match @Payments API ");
  fireEvent.keyDown(input(), { key: "Enter" });
  await flush();

  expect(host.to("/api/threads/thr_1/messages", "POST")).toEqual([
    {
      method: "POST",
      url: "/api/threads/thr_1/messages",
      body: { text: "Match [Payments API](thread:thr_2)" },
    },
  ]);
});

test("the person's message to a thread shows the mentioned thread as its chip", async () => {
  await setupPane(host, {
    thread: makeThread({ id: "thr_1", status: "idle" }),
    others: [makeThread({ id: "thr_2", title: "Payments API" })],
    messages: [
      userMessage("u0", 1, { threadId: "thr_1", text: "Wait for [Payments API](thread:thr_2)" }),
    ],
  });

  const text = await screen.findByTestId("user-message-text");
  const chip = within(text).getByTestId("thread-chip");
  expect(chip.textContent).toBe("Payments API");
  expect(chip.getAttribute("href")).toBe("/projects/prj_1/threads/thr_2");
});
