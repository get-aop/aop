import { describe, expect, test } from "bun:test";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import { projectSettings } from "../project/test-utils.ts";
import { useRoutineWorld } from "../routine/test-utils.ts";
import { spawnAndSettle } from "../thread/test-utils.ts";

const { setup } = useRoutineWorld();

const coordinatorOf = async (s: Awaited<ReturnType<typeof setup>>["s"], projectId: string) => {
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(projectId);
  if (!coordinator) throw new Error("no coordinator");
  return coordinator.id;
};

const json = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]?.text ?? "");

describe("the coordinator's routine tools", () => {
  test("create, list, update, pause, run now and delete a routine", async () => {
    const { s, project, routine } = await setup();
    const coordinator = await coordinatorOf(s, project.id);

    const created = json(
      await s.callTool(coordinator, "routine_create", {
        name: "Weekly report",
        prompt: "Write the weekly report from merged pull requests",
        schedule: { kind: "weekly", days: [5], time: "17:00" },
      }),
    );
    expect(created).toMatchObject({
      name: "Weekly report",
      enabled: true,
      when: "Every Friday at 17:00",
      nextRunAt: "2026-06-05T17:00:00.000Z",
      lastRun: null,
    });
    expect((await routine(created.id)).createdBy).toBe("coordinator");

    const listed = json(await s.callTool(coordinator, "routine_list"));
    expect(listed).toMatchObject({ timeZone: "UTC", routines: [{ id: created.id }] });

    const updated = json(
      await s.callTool(coordinator, "routine_update", {
        routineId: created.id,
        schedule: { kind: "daily", time: "08:30" },
      }),
    );
    expect(updated.when).toBe("Every day at 08:30");

    const paused = json(await s.callTool(coordinator, "routine_pause", { routineId: created.id }));
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null });
    const resumed = json(
      await s.callTool(coordinator, "routine_pause", { routineId: created.id, paused: false }),
    );
    expect(resumed.enabled).toBe(true);

    const ran = json(await s.callTool(coordinator, "routine_run_now", { routineId: created.id }));
    expect(ran).toMatchObject({ trigger: "manual" });
    expect(ran.threadId).toBeString();
    await s.settle();

    const deleted = await s.callTool(coordinator, "routine_delete", { routineId: created.id });
    expect(deleted.content[0]?.text).toBe("Routine deleted.");
    expect(json(await s.callTool(coordinator, "routine_list")).routines).toEqual([]);
  });

  test("the host's caps apply to the coordinator too, as errors it can read", async () => {
    const { s, project } = await setup();
    const coordinator = await coordinatorOf(s, project.id);

    const often = await s.callTool(coordinator, "routine_create", {
      name: "Spam",
      prompt: "Check",
      schedule: { kind: "cron", expression: "* * * * *" },
    });
    expect(often.isError).toBe(true);
    expect(often.content[0]?.text).toContain("at most every 15 minutes");

    const empty = await s.callTool(coordinator, "routine_update", { routineId: "rtn_x" });
    expect(empty).toMatchObject({ isError: true });
    const missing = await s.callTool(coordinator, "routine_pause", { routineId: "rtn_x" });
    expect(missing.content[0]?.text).toBe("Routine not found");
  });

  test("a routine of another project is not found", async () => {
    const { s, create } = await setup();
    const made = await create();
    const other = await s.services.projects.create(projectSettings({ name: "Other", repoIds: [] }));
    if (!other.success) throw new Error("no project");
    const coordinator = await coordinatorOf(s, other.project.id);

    const result = await s.callTool(coordinator, "routine_delete", { routineId: made.id });
    expect(result).toMatchObject({ isError: true, content: [{ text: "Routine not found" }] });
  });
});

describe("a thread proposing a routine", () => {
  test("reaches the coordinator as a hidden message that asks it to check with the person", async () => {
    const { s, project, threadCount } = await setup();
    const thread = await spawnAndSettle(s, project.id, { prompt: "Upgrade the dependencies" });

    const result = await s.callTool(thread.id, "aop_propose_routine", {
      name: "Weekly dependency check",
      prompt: "List outdated dependencies and open a thread to upgrade the safe ones",
      schedule: { kind: "weekly", days: [1], time: "09:00" },
      reason: "Dependencies drifted for months before this upgrade.",
    });
    expect(result.content[0]?.text).toContain("Proposal sent to the coordinator");

    const coordinator = await coordinatorOf(s, project.id);
    const stored = await s.db
      .selectFrom("chat_messages")
      .select(["id", "content", "origin_json"])
      .where("session_id", "=", coordinator)
      .where("origin_json", "like", "%routine-proposal%")
      .executeTakeFirstOrThrow();
    expect(parseMessageOrigin(stored.origin_json)).toEqual({
      type: "routine-proposal",
      threadId: thread.id,
    });
    expect(stored.content).toContain("Ask the person before creating it");
    expect(stored.content).toContain("Every Monday at 09:00");
    // Nothing is created, and the chat does not show the proposal itself.
    const listed = await s.services.routines.list(project.id);
    expect(listed.success && listed.routines).toEqual([]);
    const messages = await s.services.projects.listMessages(project.id);
    expect(messages.success && messages.messages.some((m) => m.id === stored.id)).toBe(false);
    expect(await threadCount()).toBe(1);
    await s.settle();
  });

  test("a proposal the host would refuse is turned back to the thread", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { prompt: "Watch CI" });
    const result = await s.callTool(thread.id, "aop_propose_routine", {
      name: "CI watch",
      prompt: "Check CI",
      schedule: { kind: "cron", expression: "*/2 * * * *" },
      reason: "CI breaks often.",
    });
    expect(result.isError).toBe(true);
  });
});
