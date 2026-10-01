import {
  TOOL_DETAIL_MAX_LENGTH,
  TOOL_NAME_MAX_LENGTH,
  type ToolPart,
  type TurnPart,
  TurnPartSchema,
} from "@aop/common";
import { z } from "zod";
import type { ChatMessage } from "../db/schema.ts";

/** How a run ended, as far as its parts care. */
export interface TurnEnding {
  /** The text the run ended with: the runtime's final answer, or what the host says instead. */
  text: string;
  failed?: boolean;
  aborted?: boolean;
  interrupted?: boolean;
}

/**
 * The parts a finished run stores. A call still running when the run ended did not finish: it
 * is done when the run completed, failed otherwise. The run's final text ends the turn unless the
 * turn already ends with it, so a reply that failed, was paused by a limit or was stopped says so
 * after what it wrote; a turn that was interrupted to take a new message keeps what it wrote.
 */
export const finalizeTurnParts = (parts: readonly TurnPart[], ending: TurnEnding): TurnPart[] => {
  const unfinished = ending.failed || ending.aborted || ending.interrupted;
  const settled = parts.map((part) =>
    part.type === "tool" && part.status === "running"
      ? { ...part, status: unfinished ? ("failed" as const) : ("done" as const) }
      : part,
  );
  return withFinalText(settled, ending.text, ending.interrupted === true);
};

/** Everything the turn said, as one text: its prose parts in order. */
export const turnText = (parts: readonly TurnPart[]): string =>
  parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");

/**
 * A stored reply's parts. A reply stored before parts existed is read from what it kept then:
 * its reasoning, the status paragraphs and tool calls of its activity, and its final text. Their
 * order within the turn was not kept, so the reasoning leads, the calls follow the paragraphs
 * said while working, and the final text closes the turn.
 */
export const storedTurnParts = (
  row: Pick<ChatMessage, "parts" | "activity">,
  finalText: string,
): TurnPart[] => {
  if (row.parts !== null) return parsePartsJson(row.parts);
  const legacy = parseLegacyActivity(row.activity);
  const final = finalText.trim();
  if (!legacy) return final ? [{ type: "text", text: final }] : [];
  const narration = legacyNarration(legacy.content.trim(), final);
  return [
    ...(legacy.thinking.trim()
      ? [{ type: "thinking" as const, text: legacy.thinking.trim() }]
      : []),
    ...(narration ? [{ type: "text" as const, text: narration }] : []),
    ...legacy.commandGroups.flatMap(legacyTools),
    ...(final ? [{ type: "text" as const, text: final }] : []),
  ];
};

// The content kept then is the paragraphs said while working followed by the final answer. A turn
// whose content does not end with its final text was stopped, and its content is left out rather
// than risk saying the same words twice.
const legacyNarration = (said: string, final: string): string => {
  if (!final) return said;
  return said.endsWith(final) ? said.slice(0, -final.length).trim() : "";
};

const withFinalText = (
  parts: readonly TurnPart[],
  finalText: string,
  interrupted: boolean,
): TurnPart[] => {
  const final = finalText.trim();
  const said = parts.filter((part) => part.type === "text");
  if (!final || (interrupted && said.length > 0)) return [...parts];
  const texts = said.map((part) => part.text.trim());
  if (texts.join("\n\n").endsWith(final) || texts.join("").endsWith(final)) return [...parts];
  const last = parts.at(-1);
  // The log ended inside the last paragraph: the final text is that paragraph, whole.
  if (last?.type === "text" && final.startsWith(last.text.trim())) {
    return [...parts.slice(0, -1), { type: "text", text: final }];
  }
  return [...parts, { type: "text", text: final }];
};

// A part written by another build, or by hand, is left out: one of them must not make the rest
// of a reply unreadable.
const parsePartsJson = (raw: string): TurnPart[] => {
  try {
    return z
      .array(z.unknown())
      .parse(JSON.parse(raw))
      .flatMap((part) => {
        const parsed = TurnPartSchema.safeParse(part);
        return parsed.success ? [parsed.data] : [];
      });
  } catch {
    return [];
  }
};

const LegacyActivitySchema = z.object({
  thinking: z.string().catch(""),
  content: z.string().catch(""),
  commandGroups: z.array(z.unknown()).catch([]),
});
const LegacyGroupSchema = z.object({ commands: z.array(z.unknown()) });
const LegacyCommandSchema = z.object({
  id: z.string().min(1),
  command: z.string().trim().min(1),
  detail: z.string().nullish(),
  status: z.enum(["running", "done", "failed"]),
});

const parseLegacyActivity = (raw: string | null) => {
  if (raw === null) return null;
  try {
    const parsed = LegacyActivitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const legacyTools = (raw: unknown): ToolPart[] => {
  const group = LegacyGroupSchema.safeParse(raw);
  if (!group.success) return [];
  return group.data.commands.flatMap((command): ToolPart[] => {
    const row = LegacyCommandSchema.safeParse(command);
    if (!row.success) return [];
    const detail = row.data.detail?.trim();
    return [
      {
        type: "tool",
        id: row.data.id,
        name: clip(row.data.command, TOOL_NAME_MAX_LENGTH),
        detail: detail ? clip(detail, TOOL_DETAIL_MAX_LENGTH) : null,
        // A legacy reply is finished: a call it left running did not finish.
        status: row.data.status === "running" ? "failed" : row.data.status,
      },
    ];
  });
};

/** A tool's name or detail cut to what the wire holds. */
export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
