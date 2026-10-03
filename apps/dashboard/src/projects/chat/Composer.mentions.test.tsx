import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import type { SendResult } from "./project-chat";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { Composer } = await import("./Composer");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const THREADS = [
  makeThread({
    id: "thr_login",
    title: "Fix login redirect",
    description: "Safari users land on the start page",
    lastActivityAt: "2026-10-03T10:02:00.000Z",
  }),
  makeThread({
    id: "thr_ledger",
    title: "Ledger export",
    status: "ready-for-review",
    description: "Monthly CSV for the accountants",
    artifacts: [{ type: "pr", number: 41, url: "https://github.com/o/r/pull/41", state: "open" }],
    lastActivityAt: "2026-10-03T10:01:00.000Z",
  }),
  makeThread({ id: "thr_done", title: "Old cleanup", status: "resolved" }),
];

const input = () => screen.getByTestId("composer-input") as HTMLTextAreaElement;
const picker = () => screen.queryByTestId("mention-picker");
const options = () => screen.queryAllByTestId("mention-option");
const press = (key: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(input(), { key, ...init });

// Types `text` as the box's whole content, the cursor at `caret` (the end by default).
const type = (text: string, caret = text.length) =>
  fireEvent.change(input(), {
    target: { value: text, selectionStart: caret, selectionEnd: caret },
  });

const renderComposer = (threads = THREADS) => {
  const send = mock(async (_text: string): Promise<SendResult> => ({ ok: true }));
  render(
    <Composer
      draftId="prj_1"
      placeholder="Ask the coordinator…"
      disabledReason={null}
      send={send}
      mentionThreads={threads}
    />,
  );
  return send;
};

describe("the @ picker", () => {
  test("opens on @ with every thread, resolved ones last under their heading", () => {
    renderComposer();

    type("Ask @");

    expect(picker()).not.toBeNull();
    expect(options().map((option) => option.getAttribute("data-thread-id"))).toEqual([
      "thr_login",
      "thr_ledger",
      "thr_done",
    ]);
    expect(screen.getByTestId("mention-picker-heading").textContent).toBe("Resolved");
    const ledger = options()[1];
    expect(ledger?.querySelector('[data-testid="mention-option-pr"]')?.textContent).toBe("#41");
    expect(ledger?.querySelector('[data-testid="mention-option-status"]')?.textContent).toBe(
      "Ready for review",
    );
    expect(ledger?.querySelector('[data-testid="mention-option-snippet"]')?.textContent).toBe(
      "Monthly CSV for the accountants",
    );
  });

  test("filters as the person types, by words only in a description too", () => {
    renderComposer();

    type("Ask @accountants");

    expect(options().map((option) => option.getAttribute("data-thread-id"))).toEqual([
      "thr_ledger",
    ]);
    expect(screen.getByTestId("mention-match").textContent).toBe("accountants");
  });

  test("says when nothing matches, and closes once a word that found nothing ends", () => {
    renderComposer();

    type("@zzz");
    expect(screen.getByTestId("mention-picker-empty")).toBeTruthy();
    type("@zzz ");
    expect(picker()).toBeNull();
  });

  test("does not open in an email, in code, or without threads to mention", () => {
    renderComposer();
    type("mail ana@exa");
    expect(picker()).toBeNull();
    type("run `npm i @aop");
    expect(picker()).toBeNull();
    cleanup();

    render(
      <Composer
        draftId="thr_1"
        placeholder="Steer…"
        disabledReason={null}
        send={async () => ({ ok: true })}
      />,
    );
    type("@");
    expect(picker()).toBeNull();
  });

  test("is a listbox the box points at: aria-controls and aria-activedescendant follow the arrows", () => {
    renderComposer();
    type("@");

    const listbox = screen.getByRole("listbox");
    expect(input().getAttribute("aria-controls")).toBe(listbox.id);
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]?.id ?? "");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");

    press("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1]?.id ?? "");
    press("ArrowUp");
    press("ArrowUp");
    // Up from the first wraps to the last.
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[2]?.id ?? "");
  });

  test("Escape closes it without stopping anything, and it stays closed while typing on", () => {
    const onStop = mock(() => {});
    render(
      <Composer
        draftId="prj_1"
        placeholder="Ask…"
        disabledReason={null}
        send={async () => ({ ok: true })}
        mentionThreads={THREADS}
        onStop={onStop}
      />,
    );
    type("@led");

    press("Escape");
    expect(picker()).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
    type("@ledg");
    expect(picker()).toBeNull();
    // A new @ opens it again.
    type("@ledg @");
    expect(picker()).not.toBeNull();
  });
});

describe("picking a thread", () => {
  test("Enter puts the thread in as a chip; the message is sent with its link", async () => {
    const send = renderComposer();
    type("Ask @led");

    press("Enter");

    expect(picker()).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(input().value).toBe("Ask @Ledger export ");
    const chip = screen.getByTestId("composer-mention");
    expect(chip.textContent).toBe("@Ledger export");
    expect(chip.getAttribute("data-thread-id")).toBe("thr_ledger");

    type("Ask @Ledger export about CSV");
    press("Enter");
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Ask [Ledger export](thread:thr_ledger) about CSV"),
    );
  });

  test("Tab picks the option the arrows are on", () => {
    renderComposer();
    type("@");

    press("ArrowDown");
    press("Tab");

    expect(input().value).toBe("@Ledger export ");
  });

  test("a click picks too, and keeps the cursor in the box", () => {
    renderComposer();
    input().focus();
    type("see @");

    const option = options()[0];
    if (!option) throw new Error("no option");
    fireEvent.mouseMove(option);
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(input().value).toBe("see @Fix login redirect ");
    expect(document.activeElement).toBe(input());
  });

  test("Backspace after a chip removes it whole", () => {
    renderComposer();
    type("Ask @led");
    press("Enter");
    // "Ask @Ledger export |" — the space, then the chip's last letter.
    type("Ask @Ledger export", 18);
    expect(screen.getByTestId("composer-mention")).toBeTruthy();

    type("Ask @Ledger expor", 17);

    expect(input().value).toBe("Ask ");
    expect(screen.queryByTestId("composer-mention")).toBeNull();
  });

  test("the draft keeps the chip across a reload", async () => {
    renderComposer();
    type("Ask @led");
    press("Enter");
    await act(async () => {});
    cleanup();

    renderComposer();

    expect(input().value).toBe("Ask @Ledger export ");
    expect(screen.getByTestId("composer-mention").getAttribute("data-thread-id")).toBe(
      "thr_ledger",
    );
  });
});
