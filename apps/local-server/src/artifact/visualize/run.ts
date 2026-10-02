import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths, getLogger } from "@aop/infra";
import { createProvider } from "@aop/llm-provider";
import {
  type CreateProviderFn,
  createSessionRunLogPath,
  readAssistantTextFromLog,
} from "../../chat-session/runtime-engine.ts";
import { CHAT_RUNTIME_TIMEOUT_POLICY } from "../../chat-session/runtime-timeout-policy.ts";
import type { ChatSession } from "../../db/schema.ts";
import { VISUALIZE_SYSTEM_PROMPT } from "./prompt.ts";

/** The smallest Claude model: a diagram of a reply needs no more, and it bills the person's plan. */
export const VISUALIZE_MODEL = "haiku";
const INACTIVITY_TIMEOUT_MS = 60_000;

export interface VisualizeRun {
  text: string;
  durationMs: number;
  costUsd: number | null;
}

/** One model call: what it wrote, or null when the run failed or wrote nothing. */
export type VisualizeModel = (session: ChatSession, prompt: string) => Promise<VisualizeRun | null>;

const log = getLogger("aop", "visualize");

/**
 * A one-shot Claude Code run made small: the cheapest model, no tools, no MCP, no thinking, its
 * own short system prompt instead of the CLI's, and no session kept. It runs the executable the
 * session runs (a custom runtime's alias included), in an empty folder, so no project's
 * instructions or settings reach it, and it never joins the conversation.
 */
export const createVisualizeModel =
  (createProviderFn: CreateProviderFn = createProvider): VisualizeModel =>
  async (session, prompt) => {
    const provider = createProviderFn("claude-code");
    const logFilePath = await createSessionRunLogPath(session.id);
    const cwd = join(aopPaths.home(), "visualize");
    await mkdir(cwd, { recursive: true });
    const started = Date.now();
    try {
      const result = await provider.run({
        prompt,
        systemPrompt: VISUALIZE_SYSTEM_PROMPT,
        cwd,
        isolation: "hermetic",
        builtInTools: [],
        model: VISUALIZE_MODEL,
        noSessionPersistence: true,
        env: { MAX_THINKING_TOKENS: "0" },
        runtimeAlias:
          session.runtime === "claude-code" ? (session.runtime_alias ?? undefined) : undefined,
        logFilePath,
        startupTimeoutMs: CHAT_RUNTIME_TIMEOUT_POLICY.startupTimeoutMs,
        inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
      });
      const text = result.exitCode === 0 ? await readAssistantTextFromLog(logFilePath) : "";
      if (!text) {
        log.warn("Visualize run wrote nothing", { exitCode: result.exitCode });
        return null;
      }
      return { text, durationMs: Date.now() - started, costUsd: result.usage?.costUsd ?? null };
    } catch (error) {
      log.warn("Visualize run failed", { error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      await rm(logFilePath, { force: true });
    }
  };
