import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunImage, RunOptions } from "../types";

/**
 * A prompt with images cannot be a command-line argument, so it reaches Claude Code as one
 * stream-json user message (`--input-format stream-json`) read from a file on stdin. The model
 * then sees the images themselves, whatever tools the run has: a coordinator has no Read tool
 * to open an image by its path. A prompt without images stays an argument.
 */
export const takesStdinPrompt = (options: Pick<RunOptions, "images" | "inputChannel">): boolean =>
  Boolean(options.inputChannel) || (options.images?.length ?? 0) > 0;

/**
 * The stream-json line Claude Code reads: the images in order, then the prompt's text. A `uuid`
 * comes back on the line the CLI echoes when it takes the message (`--replay-user-messages`).
 */
export const buildClaudeUserMessage = (
  prompt: string,
  images: readonly RunImage[],
  readImage: (path: string) => Buffer = readFileSync,
  uuid?: string,
): string =>
  `${JSON.stringify({
    type: "user",
    ...(uuid && { uuid }),
    message: {
      role: "user",
      content: [
        ...images.map((image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mimeType,
            data: readImage(image.path).toString("base64"),
          },
        })),
        { type: "text", text: prompt },
      ],
    },
  })}\n`;

/**
 * The stream-json line that stops the step a running turn is on, the way the Agent SDK's
 * `interrupt()` does. Verified on Claude Code 2.1.288: the CLI answers with a `control_response`
 * (its `still_queued` lists the user lines not taken yet), cancels the tool call in flight and
 * kills its process, ends the turn with an `error_during_execution` result, and then starts the
 * lines still queued as the next turn of the same process at once. SIGINT cancels the same way
 * but exits without reading what was queued, so it is not used.
 */
export const buildClaudeInterruptRequest = (requestId: string = randomUUID()): string =>
  `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } })}\n`;

/**
 * Writes the message to a file of its own and returns its path, or null for a prompt that goes
 * as an argument. `remove` is safe once the process is spawned: on Unix the child keeps its open
 * handle, so a detached run reads its prompt even after the host restarts.
 */
export const prepareStdinPrompt = (
  options: Pick<RunOptions, "prompt" | "images" | "inputChannel">,
): { path: string; remove: () => void } | null => {
  if (!takesStdinPrompt(options) || options.inputChannel) return null;
  const path = join(tmpdir(), `aop-claude-prompt-${randomUUID()}.jsonl`);
  writeFileSync(path, buildClaudeUserMessage(options.prompt, options.images ?? []), {
    mode: 0o600,
  });
  return {
    path,
    remove: () => {
      try {
        rmSync(path, { force: true });
      } catch {
        // Windows refuses to remove a file a process holds open; it goes after the run.
      }
    },
  };
};
