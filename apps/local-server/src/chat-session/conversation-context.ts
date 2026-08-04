export interface ConversationContextMessage {
  role: "user" | "assistant";
  content: string;
  outcome: "completed" | "failed" | "interrupted" | "cancelled";
}

interface FormattedContextMessage {
  content: string;
  isUser: boolean;
}

export const buildConversationContext = (
  messages: ConversationContextMessage[],
  options: { maxMessages?: number; maxCharacters?: number } = {},
): string => {
  const maxMessages = options.maxMessages ?? 12;
  const maxCharacters = options.maxCharacters ?? 12_000;
  const candidates = messages.flatMap(formatMessage);
  const selected: string[] = [];
  let characters = 0;

  for (let index = candidates.length - 1; index >= 0 && selected.length < maxMessages; index--) {
    const message = candidates[index];
    if (!message) continue;
    const remaining = maxCharacters - characters;
    const content =
      message.content.length <= remaining
        ? message.content
        : tailPreservingUserMessage(message, remaining);
    if (!content) continue;
    selected.push(content);
    characters += content.length;
  }

  return selected.reverse().join("\n\n");
};

const formatMessage = (message: ConversationContextMessage): FormattedContextMessage[] => {
  const content = message.content.trim();
  if (!content) return [];
  if (message.role === "user") return [{ content: `[user]\n${content}`, isUser: true }];
  if (message.outcome === "completed") {
    return [{ content: `[assistant completed]\n${content}`, isUser: false }];
  }
  if (message.outcome === "interrupted") {
    return [{ content: `[assistant interrupted partial]\n${content}`, isUser: false }];
  }
  return [];
};

const tailPreservingUserMessage = (
  message: FormattedContextMessage,
  remaining: number,
): string | null => {
  const marker = "[user truncated; tail preserved]\n…";
  if (!message.isUser || remaining <= marker.length) return null;
  return `${marker}${message.content.slice(-(remaining - marker.length))}`;
};
