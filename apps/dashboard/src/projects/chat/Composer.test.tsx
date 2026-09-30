import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import type { SendResult } from "./project-chat";
import { deferred } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { Composer } = await import("./Composer");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const ok: SendResult = { ok: true };
const input = () => screen.getByTestId("composer-input") as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const press = (key: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(input(), { key, ...init });

const renderComposer = (
  props: Partial<Parameters<typeof Composer>[0]> & {
    send?: (text: string) => Promise<SendResult>;
  } = {},
) => {
  const send = props.send ?? mock(async (_text: string): Promise<SendResult> => ok);
  render(
    <Composer
      draftId="thr_1"
      placeholder="Steer this thread…"
      disabledReason={null}
      {...props}
      send={send}
    />,
  );
  return send as ReturnType<typeof mock<(text: string) => Promise<SendResult>>>;
};

describe("sending", () => {
  test("Enter sends the trimmed text and empties the box; the button does the same", async () => {
    const send = renderComposer();

    type("  fix the redirect  ");
    press("Enter");
    await waitFor(() => expect(send).toHaveBeenCalledWith("fix the redirect"));
    await waitFor(() => expect(input().value).toBe(""));

    type("and the tests");
    fireEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(send).toHaveBeenCalledWith("and the tests"));
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("Shift+Enter starts a new line and sends nothing", async () => {
    const send = renderComposer();

    type("one");
    press("Enter", { shiftKey: true });
    await act(async () => {});

    expect(send).not.toHaveBeenCalled();
    expect(input().value).toBe("one");
  });

  test("Enter while the text is being composed (an IME) sends nothing", async () => {
    const send = renderComposer();

    type("にほん");
    press("Enter", { isComposing: true });
    await act(async () => {});

    expect(send).not.toHaveBeenCalled();
  });

  test("an empty or blank box has nothing to send", async () => {
    const send = renderComposer();

    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
    type("   ");
    press("Enter");
    await act(async () => {});

    expect(send).not.toHaveBeenCalled();
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
  });

  test("a second Enter while the first send is in flight sends nothing more", async () => {
    const answer = deferred<SendResult>();
    const send = renderComposer({ send: mock(() => answer.promise) });

    type("first");
    press("Enter");
    type("second");
    press("Enter");
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve(ok));
  });

  test("a refused send gives the text back with the reason", async () => {
    renderComposer({
      send: mock(async () => ({ ok: false, error: "The thread is busy" }) as SendResult),
    });

    type("steer it");
    press("Enter");

    await waitFor(() =>
      expect(screen.getByTestId("composer-error").textContent).toBe("The thread is busy"),
    );
    expect(input().value).toBe("steer it");
  });

  test("a refused send does not overwrite what the person has started typing since", async () => {
    const answer = deferred<SendResult>();
    renderComposer({ send: mock(() => answer.promise) });

    type("first");
    press("Enter");
    type("something new");
    await act(async () => answer.resolve({ ok: false, error: "nope" }));

    expect(input().value).toBe("something new");
    expect(screen.getByTestId("composer-error").textContent).toBe("nope");
  });

  test("the reason goes away with the next attempt", async () => {
    const send = mock(
      async (text: string): Promise<SendResult> =>
        text === "bad" ? { ok: false, error: "nope" } : ok,
    );
    renderComposer({ send });

    type("bad");
    press("Enter");
    await waitFor(() => expect(screen.getByTestId("composer-error")).toBeTruthy());
    type("good");
    press("Enter");

    await waitFor(() => expect(screen.queryByTestId("composer-error")).toBeNull());
  });
});

describe("a box that cannot take input", () => {
  test("says why instead of taking text, and sends nothing", async () => {
    const send = renderComposer({
      disabledReason: "Paused. Resume the project to message this thread.",
    });

    expect(screen.getByTestId("composer").getAttribute("data-disabled")).toBe("true");
    expect(input().disabled).toBe(true);
    expect(input().placeholder).toBe("Paused. Resume the project to message this thread.");
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
    press("Enter");
    await act(async () => {});
    expect(send).not.toHaveBeenCalled();
  });

  test("an open box shows its own placeholder and is not marked disabled", () => {
    renderComposer();

    expect(screen.getByTestId("composer").getAttribute("data-disabled")).toBe("false");
    expect(input().placeholder).toBe("Steer this thread…");
  });
});

describe("the draft", () => {
  test("survives a remount of the same conversation, and is kept in this browser under its id", () => {
    const { unmount } = render(
      <Composer draftId="thr_1" placeholder="p" disabledReason={null} send={async () => ok} />,
    );
    type("half a thought");
    expect(window.localStorage.getItem("aop:draft:v1:thr_1")).toBe("half a thought");
    unmount();

    render(
      <Composer draftId="thr_1" placeholder="p" disabledReason={null} send={async () => ok} />,
    );

    expect(input().value).toBe("half a thought");
  });

  test("belongs to one conversation: another draft id starts empty", () => {
    window.localStorage.setItem("aop:draft:v1:thr_1", "for thread one");

    render(
      <Composer draftId="thr_2" placeholder="p" disabledReason={null} send={async () => ok} />,
    );

    expect(input().value).toBe("");
  });

  test("is gone once it is sent", async () => {
    renderComposer();

    type("send me");
    expect(window.localStorage.getItem("aop:draft:v1:thr_1")).toBe("send me");
    press("Enter");

    await waitFor(() => expect(window.localStorage.getItem("aop:draft:v1:thr_1")).toBeNull());
  });
});

describe("stopping the agent", () => {
  test("shows a Stop button that calls onStop", () => {
    const onStop = mock(() => {});
    renderComposer({ onStop });

    fireEvent.click(screen.getByTestId("composer-stop"));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  test("Escape in the box does the same, and does not clear what was typed", () => {
    const onStop = mock(() => {});
    renderComposer({ onStop });
    type("half typed");

    press("Escape");

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("half typed");
  });

  test("Escape while the text is being composed only ends the composition", () => {
    const onStop = mock(() => {});
    renderComposer({ onStop });

    press("Escape", { isComposing: true });

    expect(onStop).not.toHaveBeenCalled();
  });

  test("without onStop there is no Stop button and Escape does nothing", () => {
    const send = renderComposer();
    type("keep me");

    press("Escape");

    expect(screen.queryByTestId("composer-stop")).toBeNull();
    expect(input().value).toBe("keep me");
    expect(send).not.toHaveBeenCalled();
  });

  test("Stop stays available while a message is typed and sending still works beside it", async () => {
    const send = renderComposer({ onStop: () => {} });

    type("steer");
    press("Enter");

    await waitFor(() => expect(send).toHaveBeenCalledWith("steer"));
    expect(screen.getByTestId("composer-stop")).toBeTruthy();
  });
});

describe("focus and chips", () => {
  test("takes the cursor when a conversation opens, unless it is disabled", () => {
    renderComposer({ focusKey: "thr_1" });
    expect(document.activeElement).toBe(input());
    cleanup();

    renderComposer({ focusKey: "thr_1", disabledReason: "Archived." });
    expect(document.activeElement).not.toBe(input());
  });

  test("shows the chips it is given in its footer", () => {
    renderComposer({ chips: <span data-testid="a-chip">Opus</span> });

    expect(screen.getByTestId("composer").contains(screen.getByTestId("a-chip"))).toBe(true);
  });
});

describe("the compact box", () => {
  test("is one line with Send beside it, not the two-row box", () => {
    renderComposer({ compact: true });
    const compact = {
      box: screen.getByTestId("composer").className,
      field: input().className,
    };
    cleanup();
    renderComposer();

    expect(compact.box).toContain("flex-wrap");
    expect(compact.field).toContain("min-h-[40px]");
    expect(screen.getByTestId("composer").className).not.toContain("flex-wrap");
    expect(input().className).toContain("min-h-[52px]");
  });

  test("still sends, and its refusal shows on a row of its own", async () => {
    renderComposer({
      compact: true,
      send: mock(async () => ({ ok: false, error: "The thread is busy" }) as SendResult),
    });

    type("answer");
    fireEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() =>
      expect(screen.getByTestId("composer-error").className).toContain("basis-full"),
    );
    expect(screen.getByTestId("composer-error").textContent).toBe("The thread is busy");
    expect(input().value).toBe("answer");
  });

  test("Enter sends from the compact box too", async () => {
    const send = renderComposer({ compact: true });

    type("Postgres");
    press("Enter");

    await waitFor(() => expect(send).toHaveBeenCalledWith("Postgres"));
  });
});
