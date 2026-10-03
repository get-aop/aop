import type { Message, UserMessage } from "@aop/common";
import { createContext, useContext } from "react";
import type { SendResult } from "./project-chat";

/** How the person answered a question: by the option whose label they sent, or in words of their own (null). */
export interface QuestionAnswer {
  choice: string | null;
}

/**
 * What a question under a coordinator reply needs from its chat: which questions are answered,
 * and how to answer one. Absent outside the coordinator chat, where a question is only shown.
 */
export interface QuestionAnswering {
  /** Message id of a reply with a question -> its answer; absent while the question is open. */
  answers: ReadonlyMap<string, QuestionAnswer>;
  /** Sends the person's reply to the coordinator, as the composer does. */
  answer: (text: string) => Promise<SendResult>;
  /** Why the person cannot answer now (a paused project); null when they can. */
  disabledReason: string | null;
}

/**
 * The host stores no answer: the person's next message is it. A question is answered once the
 * person sends anything after it was asked, by a click or by typing. A message they sent before
 * it (one that waited while the coordinator worked) and a routine's brief answer nothing. The
 * answer is the option whose label the message says, word for word, or none.
 */
export const answersOf = (messages: readonly Message[]): ReadonlyMap<string, QuestionAnswer> => {
  const answers = new Map<string, QuestionAnswer>();
  const asked = messages.flatMap((message) => {
    if (message.role !== "assistant") return [];
    const question = message.blocks.find((block) => block.type === "question");
    return question?.type === "question" ? [{ message, options: question.options }] : [];
  });
  const replies = messages.filter(isThePersons);
  for (const { message, options } of asked) {
    const askedAt = Date.parse(message.createdAt);
    const reply = replies.find((candidate) => Date.parse(candidate.createdAt) > askedAt);
    if (!reply) continue;
    const said = reply.text.trim();
    answers.set(message.id, { choice: options.find(({ label }) => label === said)?.label ?? null });
  }
  return answers;
};

// A message from a host that recorded no senders was the person's.
const isThePersons = (message: Message): message is UserMessage =>
  message.role === "user" && (message.sender ?? "person") === "person";

export const QuestionAnsweringContext = createContext<QuestionAnswering | null>(null);

export const useQuestionAnswering = (): QuestionAnswering | null =>
  useContext(QuestionAnsweringContext);
