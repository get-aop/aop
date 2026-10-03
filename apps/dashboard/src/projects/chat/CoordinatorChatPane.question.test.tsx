import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MessageBlock } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject } from "../test-utils";
import { deferred, reply, userMessage } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { mockFetch, pressEnter, settled, setup, type } = await import("./pane-test-harness");
const { AskedQuestion } = await import("./AskedQuestion");

// A question the coordinator asked with ask_person, as the person meets it in the coordinator
// chat: buttons under the reply that answer with a click, closed once the person has replied.

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/prj_1/chat");
  net = mockFetch();
});

afterEach(() => {
  cleanup();
  net.restore();
});

const question = (other = true): Extract<MessageBlock, { type: "question" }> => ({
  type: "question",
  question: "Merge it by itself, or wait for you?",
  options: [
    { label: "Merge by itself" },
    { label: "Wait for me", recommended: true },
    { label: "Close it" },
  ],
  other,
});

const asking = (other = true) =>
  reply("a1", 2, [{ type: "text", text: "The checkout thread is done." }, question(other)]);

const conversation = (...after: ReturnType<typeof userMessage>[]) => [
  Promise.resolve([userMessage("u1", 1), asking(), ...after]),
];

const block = () => screen.getByTestId("asked-question");
const options = () =>
  within(block()).getAllByTestId("asked-question-option") as HTMLButtonElement[];
const option = (label: string) =>
  options().find((button) => button.textContent?.includes(label)) as HTMLButtonElement;

describe("a question the coordinator asked", () => {
  test("shows the question under the reply with each option a button, the recommended one filled", async () => {
    setup({ fetches: conversation() });
    await settled();

    const reply = screen.getByTestId("assistant-message");
    expect(within(reply).getByTestId("asked-question")).toBe(block());
    expect(block().getAttribute("data-state")).toBe("open");
    expect(screen.getByTestId("asked-question-text").textContent).toBe(
      "Merge it by itself, or wait for you?",
    );
    expect(options().map((button) => button.textContent)).toEqual([
      "Merge by itself",
      "Wait for meRecommended",
      "Close it",
    ]);
    expect(options().map((button) => button.getAttribute("data-variant"))).toEqual([
      "outline",
      "default",
      "outline",
    ]);
    expect(option("Wait for me").getAttribute("data-recommended")).toBe("true");
    // Real buttons in a labelled group: Tab reaches each one, and Enter or Space presses it.
    for (const button of options()) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("tabindex")).toBeNull();
    }
    expect(block().getAttribute("aria-labelledby")).toBe(
      screen.getByTestId("asked-question-text").id,
    );
  });

  test("clicking an option sends its label as the person's reply, then the buttons are off and it stays marked", async () => {
    const { sent } = setup({ fetches: conversation() });
    await settled();

    fireEvent.click(option("Close it"));
    await settled();

    expect(sent).toEqual(["Close it"]);
    expect(screen.getAllByTestId("user-message").at(-1)?.textContent).toContain("Close it");
    expect(block().getAttribute("data-state")).toBe("answered");
    expect(options().every((button) => button.disabled)).toBe(true);
    expect(option("Close it").getAttribute("data-chosen")).toBe("true");
    expect(option("Close it").getAttribute("aria-pressed")).toBe("true");
    expect(option("Wait for me").getAttribute("aria-pressed")).toBe("false");
    // Once answered, the recommendation no longer stands out over the choice.
    expect(option("Wait for me").getAttribute("data-variant")).toBe("outline");
    expect((screen.getByTestId("asked-question-other") as HTMLButtonElement).disabled).toBe(true);
  });

  test("while the reply is on its way the clicked option is busy and none can be clicked again", async () => {
    const send = deferred<ReturnType<typeof userMessage>>();
    const texts: string[] = [];
    setup({
      fetches: conversation(),
      sendMessage: async (_projectId, text) => {
        texts.push(text);
        return send.promise;
      },
    });
    await settled();

    fireEvent.click(option("Merge by itself"));
    await settled();
    expect(block().getAttribute("data-state")).toBe("sending");
    expect(option("Merge by itself").getAttribute("aria-busy")).toBe("true");
    fireEvent.click(option("Close it"));
    expect(texts).toEqual(["Merge by itself"]);

    await act(async () => send.resolve(userMessage("sent", 30, { text: "Merge by itself" })));
    expect(block().getAttribute("data-state")).toBe("answered");
    // Answered, the choice shows its check and no longer the spinner of the send.
    expect(option("Merge by itself").getAttribute("aria-busy")).toBe("false");
    expect(option("Merge by itself").querySelector('[data-slot="spinner"]')).toBeNull();
  });

  test("typing an answer instead also closes it, with no option marked", async () => {
    setup({ fetches: conversation() });
    await settled();

    type("Wait, and ping me when CI is green");
    pressEnter();
    await settled();

    expect(block().getAttribute("data-state")).toBe("answered");
    expect(options().every((button) => button.disabled)).toBe(true);
    expect(options().some((button) => button.hasAttribute("data-chosen"))).toBe(false);
    expect(screen.getByTestId("asked-question-own-answer").textContent).toBe(
      "You answered in your own words.",
    );
  });

  test("Other puts the cursor in the box for an answer of the person's own", async () => {
    setup({ fetches: conversation() });
    await settled();

    fireEvent.click(screen.getByTestId("asked-question-other"));
    await act(() => new Promise((resolve) => window.requestAnimationFrame(resolve)));

    expect(document.activeElement).toBe(screen.getByTestId("composer-input"));
    expect(block().getAttribute("data-state")).toBe("open");
  });

  test("has no Other button when the coordinator did not offer one", async () => {
    setup({ fetches: [Promise.resolve([asking(false)])] });
    await settled();

    expect(screen.queryByTestId("asked-question-other")).toBeNull();
  });

  test("a send the host refuses says why and lets the person click again", async () => {
    setup({
      fetches: conversation(),
      sendMessage: async () => {
        throw new Error("The host is restarting");
      },
    });
    await settled();

    fireEvent.click(option("Wait for me"));
    await settled();

    expect(screen.getByTestId("asked-question-error").textContent).toContain(
      "The host is restarting",
    );
    expect(block().getAttribute("data-state")).toBe("open");
    expect(options().every((button) => !button.disabled)).toBe(true);
  });

  test("after a reload a question the person answered is still answered, with the option they chose", async () => {
    setup({ fetches: conversation(userMessage("u2", 3, { text: "Wait for me" })) });
    await settled();

    expect(block().getAttribute("data-state")).toBe("answered");
    expect(option("Wait for me").getAttribute("data-chosen")).toBe("true");
  });

  test("a paused project shows the question with its buttons off, and says why", async () => {
    setup({ project: makeProject({ id: "prj_1", status: "paused" }), fetches: conversation() });
    await settled();

    expect(options().every((button) => button.disabled)).toBe(true);
    expect(option("Close it").title).toContain("Paused");
  });
});

describe("a question outside the coordinator chat", () => {
  test("is shown, and nothing in it can be clicked", () => {
    render(<AskedQuestion messageId="a1" block={question()} />);

    expect(block().getAttribute("data-state")).toBe("shown");
    expect(options().every((button) => button.disabled)).toBe(true);
  });
});
