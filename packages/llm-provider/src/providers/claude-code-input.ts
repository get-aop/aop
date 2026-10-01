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
export const takesStdinPrompt = (options: Pick<RunOptions, "images">): boolean =>
  (options.images?.length ?? 0) > 0;

/** The stream-json line Claude Code reads: the images in order, then the prompt's text. */
export const buildClaudeUserMessage = (
  prompt: string,
  images: readonly RunImage[],
  readImage: (path: string) => Buffer = readFileSync,
): string =>
  `${JSON.stringify({
    type: "user",
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
 * Writes the message to a file of its own and returns its path, or null for a prompt that goes
 * as an argument. `remove` is safe once the process is spawned: on Unix the child keeps its open
 * handle, so a detached run reads its prompt even after the host restarts.
 */
export const prepareStdinPrompt = (
  options: Pick<RunOptions, "prompt" | "images">,
): { path: string; remove: () => void } | null => {
  if (!takesStdinPrompt(options)) return null;
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
