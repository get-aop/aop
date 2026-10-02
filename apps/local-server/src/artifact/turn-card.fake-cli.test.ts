import { afterEach, describe, expect, test } from "bun:test";
import { applyLiveOps, type MessageDelta, type TurnPart } from "@aop/common";
import { createLibraryProject } from "../library/test-utils.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../project/test-utils.ts";

// An artifact made during a turn, end to end with the fake CLI calling the real MCP endpoint: the
// card is a part of the turn, where the call was made, both live and in the stored reply.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const script = (calls: unknown[]): string =>
  `[fake: calls='${JSON.stringify(calls)}' say="The plan is in the card above."]`;

describe("an artifact made during a turn", () => {
  test("streams as a card after its call and is the same card in history", async () => {
    stack = await createProjectStack(home.path(), { mcp: true, repos: 0 });
    const s = stack;
    const { projectId } = await createLibraryProject(s);
    const deltas: MessageDelta[] = [];
    const subscription = s.ctx.eventPublisher.subscribe(projectId, {
      onCommit: () => undefined,
      onDelta: (delta) => deltas.push(delta),
    });

    await s.services.projects.sendToCoordinator(
      projectId,
      `plan it ${script([
        { name: "aop_artifact_create", arguments: { title: "Release plan", content: "# Plan" } },
        { name: "aop_artifact_create", arguments: { title: "Bad", content: "{", kind: "json" } },
      ])}`,
    );
    await s.settle();
    subscription.unsubscribe();

    const listed = await s.services.projects.listMessages(projectId);
    const reply = listed.success
      ? listed.messages.findLast((m) => m.role === "assistant")
      : undefined;
    const blocks = reply?.role === "assistant" ? reply.blocks : [];
    const card = blocks.find((block) => block.type === "artifact");
    expect(blocks.map((block) => block.type)).toEqual(["tool", "artifact", "tool", "text"]);
    expect(card).toMatchObject({
      type: "artifact",
      title: "Release plan",
      kind: "markdown",
      version: 1,
      action: "created",
    });
    // A refused call stays a failed tool call, with no card.
    expect(blocks[2]).toMatchObject({ type: "tool", status: "failed" });
    const live = deltas.reduce<TurnPart[] | null>(
      (parts, delta) => applyLiveOps(parts ?? [], delta.ops),
      [],
    );
    expect(live).toEqual(blocks as TurnPart[]);
    expect(
      deltas.some((delta) =>
        delta.ops.some((op) => op.op === "start" && op.part.type === "artifact"),
      ),
    ).toBe(true);
  });
});
