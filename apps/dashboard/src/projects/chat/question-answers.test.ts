import { describe, expect, test } from "bun:test";
import type { MessageBlock } from "@aop/common";
import { answersOf } from "./question-answers";
import { reply, report, userMessage } from "./test-utils";

const question: MessageBlock = {
  type: "question",
  question: "Merge it by itself, or wait for you?",
  options: [{ label: "Merge by itself", recommended: true }, { label: "Wait for me" }],
  other: true,
};

const asked = (id: string, seconds: number) =>
  reply(id, seconds, [{ type: "text", text: "The thread is done." }, question]);

describe("answersOf", () => {
  test("a question nobody has answered yet has no answer", () => {
    expect(answersOf([userMessage("u1", 1), asked("a1", 2)]).size).toBe(0);
  });

  test("the person's next message answers it with the option it names, word for word", () => {
    const answers = answersOf([
      userMessage("u1", 1),
      asked("a1", 2),
      userMessage("u2", 3, { text: "  Wait for me " }),
    ]);

    expect(answers.get("a1")).toEqual({ choice: "Wait for me" });
  });

  test("a message in the person's own words answers it with no option", () => {
    const answers = answersOf([
      asked("a1", 2),
      userMessage("u2", 3, { text: "wait for me, and ping me", sender: "person" }),
    ]);

    expect(answers.get("a1")).toEqual({ choice: null });
  });

  test("a thread's report, a routine's brief and a message sent before it was asked answer nothing", () => {
    const answers = answersOf([
      userMessage("u1", 1),
      // Sent while the coordinator worked: stored before the reply that asks.
      userMessage("u2", 2, { text: "Wait for me" }),
      asked("a1", 3),
      report("r1", 4),
      userMessage("u3", 5, { text: "Wait for me", sender: "routine" }),
    ]);

    expect(answers.has("a1")).toBe(false);
  });

  test("one message answers every question still open before it", () => {
    const answers = answersOf([
      asked("a1", 1),
      report("r1", 2),
      asked("a2", 3),
      userMessage("u1", 4, { text: "Merge by itself" }),
      asked("a3", 5),
    ]);

    expect(answers.get("a1")).toEqual({ choice: "Merge by itself" });
    expect(answers.get("a2")).toEqual({ choice: "Merge by itself" });
    expect(answers.has("a3")).toBe(false);
  });

  test("a reply without a question has no entry", () => {
    expect(answersOf([reply("a1", 1), userMessage("u1", 2)]).size).toBe(0);
  });
});
