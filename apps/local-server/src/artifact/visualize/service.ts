import type {
  ArtifactDetail,
  VisualizeCandidate,
  VisualizeGenerateInput,
  VisualizeRepairInput,
  VisualizeSaveInput,
  VisualizeType,
} from "@aop/common";
import { storedTurnParts, turnText } from "../../chat-session/turn-parts.ts";
import type { LocalServerContext } from "../../context.ts";
import type { ChatSession } from "../../db/schema.ts";
import type { ArtifactError, ArtifactResult, ArtifactService } from "../service.ts";
import { outlineOf } from "./outline.ts";
import { buildRepairPrompt, buildVisualizePrompt, extractCandidate } from "./prompt.ts";
import type { VisualizeModel } from "./run.ts";

export interface VisualizeDrawn {
  candidate: VisualizeCandidate;
  durationMs: number;
  costUsd: number | null;
}

export type VisualizeResult<T> = ArtifactResult<T>;

/**
 * Visualize: a diagram of one assistant reply, kept as an artifact linked to it. The host draws
 * and repairs; the browser checks each Mermaid candidate with the parser it renders with (it
 * needs a DOM) and saves what parsed, or the outline when nothing did. See docs/ARTIFACTS.md.
 */
export interface VisualizeService {
  /** The diagram already made of this reply, so asking again costs nothing. */
  existing: (projectId: string, messageId: string) => Promise<ArtifactDetail | null>;
  generate: (
    projectId: string,
    input: VisualizeGenerateInput,
  ) => Promise<VisualizeResult<{ drawn: VisualizeDrawn }>>;
  repair: (
    projectId: string,
    input: VisualizeRepairInput,
  ) => Promise<VisualizeResult<{ drawn: VisualizeDrawn }>>;
  /** Keeps the result: the reply's first diagram, or a new version of it. */
  save: (
    projectId: string,
    input: VisualizeSaveInput,
  ) => Promise<VisualizeResult<{ artifact: ArtifactDetail }>>;
}

export const createVisualizeService = (
  ctx: LocalServerContext,
  artifacts: ArtifactService,
  model: VisualizeModel,
): VisualizeService => {
  const draw = async (
    projectId: string,
    messageId: string,
    type: VisualizeType,
    prompt: (reply: string) => string,
  ): Promise<VisualizeResult<{ drawn: VisualizeDrawn }>> => {
    const reply = await replyOf(ctx, projectId, messageId);
    if (!reply.success) return reply;
    const run = await model(reply.session, prompt(reply.text));
    const candidate = run ? extractCandidate(run.text, type) : null;
    if (!run || !candidate) return { success: false, error: { code: "VISUALIZE_FAILED" } };
    return {
      success: true,
      drawn: { candidate, durationMs: run.durationMs, costUsd: run.costUsd },
    };
  };

  return {
    existing: (projectId, messageId) => artifacts.byOriginMessage(projectId, messageId),

    generate: (projectId, { messageId, type }) =>
      draw(projectId, messageId, type, (reply) => buildVisualizePrompt(type, reply)),

    repair: (projectId, { messageId, type, source, error }) =>
      draw(projectId, messageId, type, () => buildRepairPrompt(type, source, error)),

    save: async (projectId, input) => {
      const reply = await replyOf(ctx, projectId, input.messageId);
      if (!reply.success) return reply;
      const result = resultOf(input, reply.text);
      const existing = await artifacts.byOriginMessage(projectId, input.messageId);
      const saved = existing
        ? await artifacts.update(reply.session, {
            artifactId: existing.id,
            ...result,
            originType: input.type,
          })
        : await artifacts.create(reply.session, {
            title: titleOf(reply.text),
            content: result.content,
            kind: result.kind,
            name: `diagram-${input.messageId.slice(-8).toLowerCase()}.${result.kind === "mermaid" ? "mmd" : "md"}`,
            folder: "Artifacts/Diagrams",
            description: "Made with Visualize from a reply",
            originMessageId: input.messageId,
            note: result.note,
            originType: input.type,
          });
      return saved.success ? { success: true, artifact: saved.artifact } : saved;
    },
  };
};

// What is kept: the checked diagram, or the outline when none parsed.
const resultOf = (
  input: VisualizeSaveInput,
  reply: string,
): { content: string; kind: "mermaid" | "markdown"; note: string } =>
  input.result === "outline"
    ? { content: outlineOf(reply), kind: "markdown", note: "Outline (no valid diagram)" }
    : { content: input.candidate.source, kind: input.candidate.kind, note: TYPE_NOTES[input.type] };

const TYPE_NOTES: Record<VisualizeType, string> = {
  auto: "Diagram",
  flowchart: "Flowchart",
  sequence: "Sequence diagram",
  mindmap: "Mind map",
  timeline: "Timeline",
  table: "Table",
};

const replyOf = async (
  ctx: LocalServerContext,
  projectId: string,
  messageId: string,
): Promise<
  { success: true; session: ChatSession; text: string } | { success: false; error: ArtifactError }
> => {
  const message = await ctx.chatSessionRepository.getMessage(messageId);
  const session = message ? await ctx.chatSessionRepository.getById(message.session_id) : null;
  if (!message || !session || session.project_id !== projectId) {
    return fail("That message is not in this project");
  }
  if (message.role !== "assistant") return fail("Only an agent's reply can be visualized");
  const text = turnText(storedTurnParts(message, message.content)).trim() || message.content.trim();
  if (!text) return fail("That reply has no text to visualize");
  return { success: true, session, text };
};

// The diagram's title: the reply's first heading, else its first words.
const titleOf = (reply: string): string => {
  const heading = /^#{1,6}\s+(.+)$/m.exec(reply)?.[1];
  const words = (heading ?? reply.replace(/[#*_`>[\]()]/g, " ")).replace(/\s+/g, " ").trim();
  const short = words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words;
  return `Diagram: ${short || "reply"}`;
};

const fail = (message: string): { success: false; error: ArtifactError } => ({
  success: false,
  error: { code: "MESSAGE_NOT_FOUND", message },
});
