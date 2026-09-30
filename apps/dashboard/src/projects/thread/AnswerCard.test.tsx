import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BlockedQuestion, Thread } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import type { SendResult } from "../chat/project-chat";
import { deferred } from "../chat/test-utils";
import { makeThread } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AnswerCard } = await import("./AnswerCard");

type Waiting = Extract<Thread, { status: "waiting-on-you" }>;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const waiting = (blockedQuestion: BlockedQuestion): Waiting => ({
  ...(makeThread({ id: "thr_1", status: "waiting-on-you" }) as Waiting),
  blockedQuestion,
});

const CHOICE: BlockedQuestion = {
  question: "Which database?",
  options: [
    { label: "Postgres", recommended: true },
    { label: "SQLite", recommended: false },
  ],
};

const setup = (
  question: BlockedQuestion = CHOICE,
  overrides: {
    answer?: (text: string) => Promise<SendResult>;
    disabledReason?: string | null;
  } = {},
) => {
  const answers: string[] = [];
  const answer =
    overrides.answer ??
    (async (text: string): Promise<SendResult> => {
      answers.push(text);
      return { ok: true };
    });
  render(
    <AnswerCard
      thread={waiting(question)}
      answer={answer}
      disabledReason={overrides.disabledReason ?? null}
    />,
  );
  return { answers };
};

const options = () => screen.getAllByTestId("answer-option") as HTMLButtonElement[];

describe("the question and its options", () => {
  test("shows the question and every option as a button, in the order the thread gave them", () => {
    setup();

    expect(screen.getByTestId("answer-question").textContent).toBe("Which database?");
    expect(options().map((button) => button.textContent)).toEqual([
      "PostgresRecommended",
      "SQLite",
    ]);
  });

  test("marks the recommended option, and only that one", () => {
    setup();

    const [postgres, sqlite] = options();
    expect(postgres?.getAttribute("data-recommended")).toBe("true");
    expect(sqlite?.getAttribute("data-recommended")).toBe("false");
    // The recommended one is the primary action; the other is an outline.
    expect(postgres?.getAttribute("data-variant")).toBe("default");
    expect(sqlite?.getAttribute("data-variant")).toBe("outline");
  });

  test("a question with no options has no buttons and asks for an answer", () => {
    setup({ question: "What should the endpoint be called?", options: [] });

    expect(screen.queryByTestId("answer-options")).toBeNull();
    expect(screen.getByTestId("composer-input").getAttribute("placeholder")).toBe(
      "Write your answer…",
    );
  });

  test("with options, the box invites an answer of the person's own", () => {
    setup();

    expect(screen.getByTestId("composer-input").getAttribute("placeholder")).toBe(
      "Or write your own answer…",
    );
  });
});

describe("answering", () => {
  test("clicking an option answers with its label", async () => {
    const { answers } = setup();

    fireEvent.click(options()[1] as HTMLButtonElement);
    await act(async () => {});

    expect(answers).toEqual(["SQLite"]);
  });

  test("while the answer is on its way every option is disabled, so it cannot be given twice", async () => {
    const pending = deferred<SendResult>();
    const asked: string[] = [];
    setup(CHOICE, {
      answer: (text) => {
        asked.push(text);
        return pending.promise;
      },
    });

    fireEvent.click(options()[0] as HTMLButtonElement);
    expect(options().every((button) => button.disabled)).toBe(true);
    fireEvent.click(options()[1] as HTMLButtonElement);
    expect(asked).toEqual(["Postgres"]);

    await act(async () => pending.resolve({ ok: true }));
    expect(options().every((button) => !button.disabled)).toBe(true);
  });

  test("a refused answer is shown, and the options work again", async () => {
    const results: SendResult[] = [
      { ok: false, error: "The thread is not waiting on an answer" },
      { ok: true },
    ];
    const asked: string[] = [];
    setup(CHOICE, {
      answer: async (text) => {
        asked.push(text);
        return results.shift() ?? { ok: true };
      },
    });

    fireEvent.click(options()[0] as HTMLButtonElement);
    await act(async () => {});

    expect(screen.getByTestId("answer-error").textContent).toBe(
      "The thread is not waiting on an answer",
    );
    expect(options().every((button) => !button.disabled)).toBe(true);

    fireEvent.click(options()[1] as HTMLButtonElement);
    await act(async () => {});

    expect(asked).toEqual(["Postgres", "SQLite"]);
    expect(screen.queryByTestId("answer-error")).toBeNull();
  });

  test("free text goes through the box with Enter, as the answer", async () => {
    const { answers } = setup();

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "MySQL, please" } });
    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Enter" });
    await act(async () => {});

    expect(answers).toEqual(["MySQL, please"]);
  });

  test("the box sends with its button too, and a refused free-text answer comes back into the box", async () => {
    setup(CHOICE, { answer: async () => ({ ok: false, error: "The thread moved on" }) });

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "MySQL" } });
    fireEvent.click(screen.getByTestId("composer-send"));
    await act(async () => {});

    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe("MySQL");
    expect(screen.getByTestId("composer-error").textContent).toBe("The thread moved on");
  });

  test("an empty box sends nothing", async () => {
    const { answers } = setup();

    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Enter" });
    await act(async () => {});

    expect(answers).toEqual([]);
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("when nothing can be sent", () => {
  test("a reason disables every option and the box, and says why in the box", async () => {
    const { answers } = setup(CHOICE, {
      disabledReason: "Paused. Resume the project to message this thread.",
    });

    expect(options().every((button) => button.disabled)).toBe(true);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("placeholder")).toBe(
      "Paused. Resume the project to message this thread.",
    );

    fireEvent.click(options()[0] as HTMLButtonElement);
    await act(async () => {});
    expect(answers).toEqual([]);
  });
});
