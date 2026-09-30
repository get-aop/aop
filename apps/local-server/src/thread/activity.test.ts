import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_DETAIL_MAX_LENGTH,
  ACTIVITY_LABEL_MAX_LENGTH,
  ACTIVITY_NARRATION_MAX_LENGTH,
  ACTIVITY_ROWS_PER_TURN_MAX,
  ACTIVITY_TURNS_MAX,
  ThreadActivitySchema,
} from "@aop/common";
import {
  publishAssistantProgress,
  resetAssistantProgress,
} from "../chat-session/session-events.ts";
import { eventually, type ProjectStack } from "../project/test-utils.ts";
import { readThreadActivity } from "./activity.ts";
import { spawnAndSettle, useThreadWorld } from "./test-utils.ts";

const world = useThreadWorld();

const activityOf = async (s: ProjectStack, threadId: string) => {
  const result = await readThreadActivity(s.ctx, threadId);
  if (!result.success) throw new Error(`no activity: ${JSON.stringify(result.error)}`);
  return result.activity;
};

/** Stores an assistant message whose activity is exactly `activity` (any JSON, or a raw string). */
const storeTurn = async (
  s: ProjectStack,
  threadId: string,
  id: string,
  turnIndex: number,
  text: string,
  activity: unknown,
) => {
  await s.db
    .insertInto("chat_messages")
    .values({
      id,
      session_id: threadId,
      role: "assistant",
      content: text,
      activity: typeof activity === "string" ? activity : JSON.stringify(activity),
      turn_index: turnIndex,
      created_at: new Date(Date.UTC(2026, 8, 30, 12, turnIndex)).toISOString(),
    })
    .execute();
};

const command = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  command: "Bash",
  detail: `echo ${id}`,
  status: "done",
  exitCode: 0,
  ...overrides,
});

describe("a thread's activity", () => {
  test("a finished turn lists its tool calls and what it said while working, not the final answer or tool output", async () => {
    const { s, project } = await world.setup();
    const thread = await spawnAndSettle(s, project.id, {
      title: "Work",
      prompt: 'go [fake: steps=2 say="All done."]',
    });
    const message = await s.db
      .selectFrom("chat_messages")
      .select("id")
      .where("session_id", "=", thread.id)
      .where("role", "=", "assistant")
      .executeTakeFirstOrThrow();

    const activity = await activityOf(s, thread.id);

    // The fake's tool results ("step 1") are stored with the turn and must not leave the host.
    expect(activity).toEqual({
      turns: [
        {
          messageId: message.id,
          running: false,
          narration: "Working on step 1 of 2.\n\nWorking on step 2 of 2.",
          groups: [
            {
              id: "cg_1",
              rows: [
                { id: "toolu_fake_1_1", label: "Bash", detail: "echo step 1", status: "done" },
              ],
            },
            {
              id: "cg_2",
              rows: [
                { id: "toolu_fake_1_3", label: "Bash", detail: "echo step 2", status: "done" },
              ],
            },
          ],
        },
      ],
    });
    expect(ThreadActivitySchema.safeParse(activity).success).toBe(true);
  });

  test("turns come oldest first, and a turn that only talked has nothing to show and is left out", async () => {
    const { s, project } = await world.setup();
    const thread = await spawnAndSettle(s, project.id, {
      title: "Work",
      prompt: 'first [fake: steps=1 say="One."]',
    });
    await s.services.threads.send(thread.id, 'just talk [fake: say="Hi."]');
    await s.settle();
    await s.services.threads.send(thread.id, 'again [fake: steps=1 say="Two."]');
    await s.settle();

    const { turns } = await activityOf(s, thread.id);

    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.groups[0]?.rows[0]?.detail)).toEqual([
      "echo step 1",
      "echo step 1",
    ]);
    const stored = await s.db
      .selectFrom("chat_messages")
      .select("id")
      .where("session_id", "=", thread.id)
      .where("role", "=", "assistant")
      .orderBy("turn_index")
      .execute();
    expect(turns.map((turn) => turn.messageId)).toEqual([stored[0]?.id, stored[2]?.id] as string[]);
  });

  test("skips a row, a group or a whole turn that cannot be read and keeps the rest", async () => {
    const { s, project } = await world.setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "hello" });
    await storeTurn(s, thread.id, "smsg_odd", 5, "Fine.", {
      thinking: "",
      content: "Looking.\n\nFine.",
      commandGroups: [
        "not a group",
        {
          id: "cg_a",
          commands: [command("ok"), { id: "x", command: "Bash", status: "paused" }, 7],
        },
        { id: "cg_b", commands: [command("blank", { command: "  " })] },
        { commands: [command("no-group-id")] },
      ],
    });
    await storeTurn(s, thread.id, "smsg_broken", 6, "Broken.", "{not json");
    await storeTurn(s, thread.id, "smsg_null", 7, "Nothing.", "null");

    const { turns } = await activityOf(s, thread.id);

    expect(turns).toEqual([
      {
        messageId: "smsg_odd",
        running: false,
        narration: "Looking.",
        groups: [
          { id: "cg_a", rows: [{ id: "ok", label: "Bash", detail: "echo ok", status: "done" }] },
        ],
      },
    ]);
  });

  test("a stopped turn, whose content does not end with its message, shows its tool calls but not its content", async () => {
    const { s, project } = await world.setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "hello" });
    await storeTurn(s, thread.id, "smsg_stopped", 5, "Conversation stopped.", {
      content: "Half a thought",
      commandGroups: [{ id: "cg_1", commands: [command("t1", { status: "failed" })] }],
    });

    const { turns } = await activityOf(s, thread.id);

    expect(turns).toMatchObject([
      { messageId: "smsg_stopped", narration: "", groups: [{ rows: [{ status: "failed" }] }] },
    ]);
  });

  test("keeps the latest rows and the end of the narration when a turn made more than a page holds, and caps long text", async () => {
    const { s, project } = await world.setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "hello" });
    const many = Array.from({ length: ACTIVITY_ROWS_PER_TURN_MAX + 50 }, (_, index) =>
      command(`t${index}`),
    );
    const long = "x".repeat(ACTIVITY_DETAIL_MAX_LENGTH * 2);
    await storeTurn(s, thread.id, "smsg_big", 5, "Done.", {
      content: `${"a".repeat(ACTIVITY_NARRATION_MAX_LENGTH)}THE END\n\nDone.`,
      commandGroups: [
        { id: "cg_1", commands: many.slice(0, 100) },
        { id: "cg_2", commands: many.slice(100) },
        {
          id: "cg_3",
          commands: [command("wide", { command: "y".repeat(500), detail: long })],
        },
      ],
    });

    const { turns } = await activityOf(s, thread.id);
    const turn = turns[0];

    expect(turn?.narration).toHaveLength(ACTIVITY_NARRATION_MAX_LENGTH);
    expect(turn?.narration.endsWith("THE END")).toBe(true);
    const rows = turn?.groups.flatMap((group) => group.rows) ?? [];
    expect(rows).toHaveLength(ACTIVITY_ROWS_PER_TURN_MAX);
    expect(rows.at(-1)).toMatchObject({ id: "wide" });
    expect(rows[0]?.id).toBe("t51");
    expect(rows.at(-1)?.label).toHaveLength(ACTIVITY_LABEL_MAX_LENGTH);
    expect(rows.at(-1)?.detail).toHaveLength(ACTIVITY_DETAIL_MAX_LENGTH);
    expect(ThreadActivitySchema.safeParse({ turns }).success).toBe(true);
  });

  test("returns at most the latest turns", async () => {
    const { s, project } = await world.setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "hello" });
    for (let index = 0; index < ACTIVITY_TURNS_MAX + 5; index += 1) {
      await storeTurn(s, thread.id, `smsg_t${String(index).padStart(2, "0")}`, 10 + index, "Ok.", {
        content: "Ok.",
        commandGroups: [{ id: "cg_1", commands: [command(`t${index}`)] }],
      });
    }

    const { turns } = await activityOf(s, thread.id);

    expect(turns).toHaveLength(ACTIVITY_TURNS_MAX);
    expect(turns[0]?.messageId).toBe("smsg_t05");
    expect(turns.at(-1)?.messageId).toBe("smsg_t34");
  });

  test("a running turn is last, keyed by the id its message will have, and carries its calls but not its text", async () => {
    const { s, project } = await world.setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: 'go [fake: steps=3 delay=300 say="Finished."]',
    });
    if (!spawned.success) throw new Error("thread not spawned");

    const live = await eventually(async () => {
      const { turns } = await activityOf(s, spawned.thread.id);
      return turns.find((turn) => turn.running && turn.groups.length > 0);
    }, "the running turn's first tool call");
    await s.settle();
    const { turns } = await activityOf(s, spawned.thread.id);

    expect(live.narration).toBe("");
    expect(live.groups[0]?.rows[0]).toMatchObject({ label: "Bash", detail: "echo step 1" });
    // Once the turn ends its message has the id the live turn carried, and the turn is no longer running.
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ messageId: live.messageId, running: false });
    expect(turns[0]?.groups).toHaveLength(3);
    expect(turns[0]?.narration).toContain("Working on step 1 of 3.");
  });

  test("progress left in memory by a turn that is not running is not a running turn", async () => {
    const { s, project } = await world.setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "hello" });
    publishAssistantProgress(thread.id, {
      thinking: "",
      content: "stale",
      commandGroups: [{ id: "cg_1", commands: [{ id: "t1", command: "Bash", status: "running" }] }],
    });

    const { turns } = await activityOf(s, thread.id);
    resetAssistantProgress(thread.id);

    expect(turns).toEqual([]);
  });

  test("an unknown thread and the coordinator are not found", async () => {
    const { s, project } = await world.setup();
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);

    expect(await readThreadActivity(s.ctx, "isess_nope")).toEqual({
      success: false,
      error: { code: "THREAD_NOT_FOUND" },
    });
    expect(await readThreadActivity(s.ctx, coordinator?.id ?? "")).toEqual({
      success: false,
      error: { code: "THREAD_NOT_FOUND" },
    });
  });
});
