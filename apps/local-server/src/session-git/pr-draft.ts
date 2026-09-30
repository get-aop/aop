import { getLogger } from "@aop/infra";
import { createProvider, type LLMProvider, supportsNativePlanMode } from "@aop/llm-provider";
import {
  createSessionRunLogPath,
  readAssistantTextFromLog,
} from "../chat-session/runtime-engine.ts";
import { CHAT_RUNTIME_TIMEOUT_POLICY } from "../chat-session/runtime-timeout-policy.ts";
import type { ChatMessage, ChatSession } from "../db/schema.ts";

export interface PullRequestDraft {
  title: string;
  body: string;
}

export interface GeneratePullRequestDraftInput {
  session: ChatSession;
  workspace: string;
  messages: ChatMessage[];
  changedFiles: string[];
  fallbackTitle: string;
  /** Test seam; production uses the runtime's configured provider. */
  createProviderFn?: (key: string) => LLMProvider;
}

export type GeneratePullRequestDraft = (
  input: GeneratePullRequestDraftInput,
) => Promise<PullRequestDraft | null>;

const draftLogger = getLogger("aop", "pr-draft");

const MAX_MESSAGE_CHARS = 2_000;
const MAX_EXCERPT_CHARS = 12_000;
const MAX_TITLE_CHARS = 120;
/** Summaries are best-effort; never let a hung runtime block PR creation. */
const DRAFT_INACTIVITY_TIMEOUT_MS = 90_000;
const TAIL_MESSAGE_COUNT = 6;

/**
 * One-shot summary of the session task through the session's own runtime.
 * Returns null (and the caller falls back to the session title) whenever the
 * run fails, times out, or produces unparseable output.
 */
export const generatePullRequestDraft: GeneratePullRequestDraft = async (input) => {
  const hasUserMessage = input.messages.some((message) => message.role === "user");
  if (!hasUserMessage) return null;

  const providerKey = input.session.runtime;
  const provider = input.createProviderFn?.(providerKey) ?? createProvider(providerKey);
  const logFilePath = await createSessionRunLogPath(input.session.id);

  try {
    const result = await provider.run({
      prompt: buildDraftPrompt(input),
      cwd: input.workspace,
      isolation: "hermetic",
      // Read-only native plan mode keeps the summary run from mutating the repo.
      mode: supportsNativePlanMode(provider.name) ? "plan" : "execute",
      model: input.session.model,
      reasoningEffort: input.session.reasoning_effort,
      fastMode: Boolean(input.session.fast_mode),
      runtimeAlias: input.session.runtime_alias ?? undefined,
      logFilePath,
      startupTimeoutMs: CHAT_RUNTIME_TIMEOUT_POLICY.startupTimeoutMs,
      inactivityTimeoutMs: DRAFT_INACTIVITY_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      draftLogger.warn("PR draft runtime failed; falling back to the session title", {
        runtime: input.session.runtime,
        exitCode: result.exitCode,
      });
      return null;
    }
    const text = await readAssistantTextFromLog(logFilePath);
    return parsePullRequestDraft(text);
  } catch (error) {
    draftLogger.warn("PR draft generation failed; falling back to the session title", {
      runtime: input.session.runtime,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const buildDraftPrompt = (input: GeneratePullRequestDraftInput): string => {
  const fileList =
    input.changedFiles.length > 0 ? input.changedFiles.join("\n") : "(no file changes detected)";
  return [
    "You are drafting a GitHub pull request for a coding task completed in an AOP chat session.",
    "",
    `Session title: ${input.fallbackTitle.trim() || "(untitled)"}`,
    "",
    "Changed files:",
    fileList,
    "",
    "Task conversation:",
    buildConversationExcerpt(input.messages),
    "",
    "Reply with ONLY a JSON object and nothing else (no markdown fences, no commentary):",
    '{"title": "<PR title: imperative mood, max 72 characters, no backticks>", "body": "<PR description in GitHub markdown: 2-5 bullet points summarizing what was done, plus a Testing note when relevant>"}',
  ].join("\n");
};

const buildConversationExcerpt = (messages: ChatMessage[]): string => {
  const userMessages = messages.filter((message) => message.role === "user");
  const head = userMessages[0];
  const tail = messages.slice(-TAIL_MESSAGE_COUNT);
  const parts: string[] = [];
  if (head && !tail.includes(head)) {
    parts.push(`[original request]\n${truncateMessage(head.content)}`);
  }
  for (const message of tail) {
    parts.push(`[${message.role}]\n${truncateMessage(message.content)}`);
  }
  return parts.join("\n\n").slice(0, MAX_EXCERPT_CHARS);
};

const truncateMessage = (content: string): string => {
  const trimmed = content.trim();
  return trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…` : trimmed;
};

export const parsePullRequestDraft = (text: string): PullRequestDraft | null => {
  const json = extractJsonObject(text);
  if (!json) return null;
  const title = typeof json.title === "string" ? json.title.trim() : "";
  const body = typeof json.body === "string" ? json.body.trim() : "";
  if (!title || !body) return null;
  return { title: title.slice(0, MAX_TITLE_CHARS), body };
};

const extractJsonObject = (text: string): Record<string, unknown> | null => {
  const trimmed = text.trim();
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")];
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed) return parsed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? tryParseJson(trimmed.slice(start, end + 1)) : null;
};

const tryParseJson = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON; try the next candidate.
  }
  return null;
};
