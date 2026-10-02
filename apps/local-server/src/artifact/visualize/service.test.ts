import { afterEach, describe, expect, test } from "bun:test";
import type { ArtifactDetail, VisualizeCandidate } from "@aop/common";
import { createLibraryProject } from "../../library/test-utils.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../../project/test-utils.ts";
import { createArtifactService } from "../service.ts";
import { VISUALIZE_SYSTEM_PROMPT } from "./prompt.ts";
import { VISUALIZE_MODEL, type VisualizeModel } from "./run.ts";
import { createVisualizeService } from "./service.ts";

// Visualize over the real chat engine: a coordinator reply written by the fake CLI, the one-shot
// run the fake answers (its prompt carries the reply, so a marker in the reply scripts it), and
// the artifact the result is kept as.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

/** A project whose coordinator replied `reply` (the fake says it), and that reply's message id. */
const replyWith = async (reply: string) => {
  const s = await createProjectStack(home.path(), { repos: 0 });
  stack = s;
  const { projectId, coordinator } = await createLibraryProject(s);
  await s.services.projects.sendToCoordinator(projectId, `go [fake: say="${reply}"]`);
  await s.settle();
  const messages = await s.ctx.chatSessionRepository.listMessages(coordinator.id);
  const answer = messages.findLast((message) => message.role === "assistant");
  if (!answer) throw new Error("no reply");
  return { s, projectId, coordinator, messageId: answer.id, userMessageId: messages[0]?.id ?? "" };
};

const post = <T>(s: ProjectStack, projectId: string, action: string, body: unknown) =>
  s.api<T>("POST", `/api/projects/${projectId}/visualize/${action}`, body);

describe("visualize routes", () => {
  test("draws a diagram with a small run that never touches the conversation", async () => {
    const { s, projectId, coordinator, messageId } = await replyWith(
      "Release steps [fake: say='flowchart TD; A[Bump]-->B[Tag]']",
    );
    const before = await s.ctx.chatSessionRepository.countMessages(coordinator.id);
    const runsBefore = s.runs.length;

    const { status, body } = await post<{ candidate: VisualizeCandidate }>(
      s,
      projectId,
      "generate",
      {
        messageId,
        type: "flowchart",
      },
    );

    expect(status).toBe(200);
    expect(body.candidate).toEqual({ kind: "mermaid", source: "flowchart TD; A[Bump]-->B[Tag]" });
    const run = s.runs[runsBefore];
    expect(run).toMatchObject({
      model: VISUALIZE_MODEL,
      systemPrompt: VISUALIZE_SYSTEM_PROMPT,
      builtInTools: [],
      noSessionPersistence: true,
      isolation: "hermetic",
      env: { MAX_THINKING_TOKENS: "0" },
    });
    expect(run?.mcpServerUrl).toBeUndefined();
    expect(run?.resumeSessionId).toBeUndefined();
    expect(run?.prompt).toContain("Draw a Mermaid flowchart");
    expect(run?.prompt).toContain("Release steps");
    expect(await s.ctx.chatSessionRepository.countMessages(coordinator.id)).toBe(before);
  });

  test("repairs from the broken source and the parser's words, without the reply", async () => {
    const { s, projectId, messageId } = await replyWith("Plain words");
    const runsBefore = s.runs.length;

    const { body } = await post<{ candidate: VisualizeCandidate }>(s, projectId, "repair", {
      messageId,
      type: "sequence",
      source: "sequenceDiagram\nA->>B [fake: say='sequenceDiagram; A->>B: hi']",
      error: "Parse error on line 2",
    });

    expect(body.candidate.source).toBe("sequenceDiagram; A->>B: hi");
    const prompt = s.runs[runsBefore]?.prompt ?? "";
    expect(prompt).toContain("Parse error on line 2");
    expect(prompt).toContain("Draw a Mermaid sequence diagram");
    expect(prompt).not.toContain("Plain words");
  });

  test("saves the result once per reply: later saves are versions, the fallback an outline", async () => {
    const { s, projectId, messageId } = await replyWith(
      "## Plan\n\n- Bump the version\n- Tag it. Then publish.",
    );
    const save = (body: Record<string, unknown>) =>
      post<{ artifact: ArtifactDetail }>(s, projectId, "save", { messageId, ...body });
    expect((await s.api(`GET`, `/api/projects/${projectId}/visualize/${messageId}`)).body).toEqual({
      artifact: null,
    });

    const first = await save({
      type: "flowchart",
      result: "diagram",
      candidate: { kind: "mermaid", source: "flowchart TD\nA-->B" },
    });
    const second = await save({
      type: "table",
      result: "diagram",
      candidate: { kind: "markdown", source: "| a |\n| --- |\n| 1 |" },
    });
    const outline = await save({ type: "mindmap", result: "outline" });

    expect(first.body.artifact).toMatchObject({
      title: "Diagram: Plan",
      kind: "mermaid",
      folder: "Artifacts/Diagrams",
      originMessageId: messageId,
      currentVersion: 1,
    });
    expect(second.body.artifact.id).toBe(first.body.artifact.id);
    expect(outline.body.artifact.versions.map(({ kind, note }) => ({ kind, note }))).toEqual([
      { kind: "mermaid", note: null },
      { kind: "markdown", note: "Table" },
      { kind: "markdown", note: "Outline (no valid diagram)" },
    ]);
    const content = await s.app.request(
      `/api/projects/${projectId}/artifacts/${first.body.artifact.id}/versions/3/content`,
    );
    expect(await content.text()).toBe(
      "# Outline\n\n- **Plan**\n  - Bump the version\n  - Tag it. Then publish.",
    );
    const cached = await s.api<{ artifact: ArtifactDetail }>(
      "GET",
      `/api/projects/${projectId}/visualize/${messageId}`,
    );
    expect(cached.body.artifact.currentVersion).toBe(3);
  });

  test("refuses the person's own message, another project's and a bad request", async () => {
    const { s, projectId, userMessageId, messageId } = await replyWith("Words");
    const other = await createLibraryProject(s, "Other");

    const own = await post<{ error: string }>(s, projectId, "generate", {
      messageId: userMessageId,
      type: "auto",
    });
    expect(own.status).toBe(404);
    expect(own.body.error).toBe("Only an agent's reply can be visualized");
    const elsewhere = await post(s, other.projectId, "generate", { messageId, type: "auto" });
    expect(elsewhere.status).toBe(404);
    expect((await post(s, projectId, "generate", { messageId, type: "pie" })).status).toBe(400);
  });
});

describe("visualize service with a scripted model", () => {
  const withModel = async (texts: (string | null)[]) => {
    const { s, projectId, messageId } = await replyWith("A reply");
    const queue = [...texts];
    const model: VisualizeModel = async () => {
      const text = queue.shift() ?? null;
      return text === null ? null : { text, durationMs: 5, costUsd: 0.0015 };
    };
    const service = createVisualizeService(
      s.ctx,
      createArtifactService(s.ctx, s.services.library),
      model,
    );
    return { service, projectId, messageId };
  };

  test("takes the diagram out of a fence and reports what the run cost", async () => {
    const { service, projectId, messageId } = await withModel([
      "Here you go:\n```mermaid\nmindmap\n  root((A))\n```\nEnjoy",
    ]);
    const drawn = await service.generate(projectId, { messageId, type: "mindmap" });
    expect(drawn).toEqual({
      success: true,
      drawn: {
        candidate: { kind: "mermaid", source: "mindmap\n  root((A))" },
        durationMs: 5,
        costUsd: 0.0015,
      },
    });
  });

  test("a run that fails, says nothing, or answers a table with no table, is a failed draw", async () => {
    const { service, projectId, messageId } = await withModel([null, "   ", "no table here"]);
    const failed = { success: false, error: { code: "VISUALIZE_FAILED" } };
    expect(await service.generate(projectId, { messageId, type: "auto" })).toEqual(failed);
    expect(await service.generate(projectId, { messageId, type: "auto" })).toEqual(failed);
    expect(await service.generate(projectId, { messageId, type: "table" })).toEqual(failed);
  });

  test("an invalid diagram is repaired; a repair that fails leaves the outline to save", async () => {
    const { service, projectId, messageId } = await withModel([
      "flowchart TD\nA-->",
      "flowchart TD\nA-->B",
      null,
    ]);
    const first = await service.generate(projectId, { messageId, type: "flowchart" });
    if (!first.success) throw new Error("no draw");
    // The browser's parser refuses it; the host is asked to repair.
    const repaired = await service.repair(projectId, {
      messageId,
      type: "flowchart",
      source: first.drawn.candidate.source,
      error: "Expecting 'AMP'",
    });
    expect(repaired.success && repaired.drawn.candidate.source).toBe("flowchart TD\nA-->B");
    const again = await service.repair(projectId, {
      messageId,
      type: "flowchart",
      source: "x",
      error: "still bad",
    });
    expect(again.success).toBe(false);
    const saved = await service.save(projectId, {
      messageId,
      type: "flowchart",
      result: "outline",
    });
    expect(saved.success && saved.artifact.kind).toBe("markdown");
  });
});
