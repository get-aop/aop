/**
 * Generates the exact SSE event stream the dashboard would receive for a real
 * PI chat run: replays the JSONL log through the real parser + accumulator +
 * 100ms emit throttle + publishAssistantProgress delta chain.
 *
 * Usage: bun e2e-tests/src/reveal-schedule-gen.ts <run.jsonl> <out-events.jsonl>
 * Output: one JSON object per line: { type, data } where data is the SSE payload
 * (assistant-progress events already carry suffix deltas / replace flags).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createStreamProgressAccumulator } from "../../apps/local-server/src/chat-session/stream-progress";
import { parseStreamProgressLines } from "../../apps/local-server/src/chat-session/stream-progress-parse";

const [logPath, outPath] = process.argv.slice(2);
const lines = readFileSync(logPath, "utf8").split("\n");
const acc = createStreamProgressAccumulator();

const MIN_EMIT_MS = 100;
let lastEmitAt = -1_000_000;
let pending: ReturnType<typeof acc.get> | null = null;
let virtualMs = 0;
const events: Array<{ type: string; data: unknown }> = [];
let prevThinking = "";
let prevContent = "";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: delta-chain emitter
const emit = (snapshot: ReturnType<typeof acc.get>, force = false) => {
  if (!force && virtualMs - lastEmitAt < MIN_EMIT_MS) {
    pending = snapshot;
    return;
  }
  lastEmitAt = virtualMs;
  pending = null;
  const replace =
    !(prevThinking.length === 0 || snapshot.thinking.startsWith(prevThinking)) ||
    !(prevContent.length === 0 || snapshot.content.startsWith(prevContent));
  const thinking = replace
    ? snapshot.thinking
    : prevThinking.length > 0
      ? snapshot.thinking.slice(prevThinking.length)
      : snapshot.thinking;
  const content = replace
    ? snapshot.content
    : prevContent.length > 0
      ? snapshot.content.slice(prevContent.length)
      : snapshot.content;
  prevThinking = snapshot.thinking;
  prevContent = snapshot.content;
  events.push({
    type: "assistant-progress",
    data: {
      sessionId: "harness",
      thinking,
      content,
      commandGroups: snapshot.commandGroups,
      ...(replace ? { replace: true } : {}),
    },
  });
};

events.push({ type: "assistant-typing", data: { sessionId: "harness", userMessageId: "m1" } });

for (const line of lines) {
  if (!line.trim()) continue;
  virtualMs += 100; // one server poll tick per processed line batch
  const chunks = parseStreamProgressLines(line);
  if (chunks.length === 0) continue;
  emit(acc.applyAll(chunks));
}
if (pending) emit(pending, true);

// Final event: full cumulative text so the harness can compare at the end.
events.push({
  type: "assistant-final",
  data: {
    sessionId: "harness",
    message: {
      id: "m2",
      sessionId: "harness",
      role: "assistant",
      content: acc.get().content,
      activity: {
        thinking: acc.get().thinking,
        content: acc.get().content,
        commandGroups: [],
      },
      createdAt: new Date().toISOString(),
    },
  },
});

writeFileSync(outPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(
  `events: ${events.length} (progress frames: ${events.filter((e) => e.type === "assistant-progress").length})`,
);
console.log(`final thinking: ${prevThinking.length} chars, content: ${prevContent.length} chars`);
