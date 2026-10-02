import { describe, expect, test } from "bun:test";
import type { Thread } from "@aop/common";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import { insertProjectSession } from "../project/test-utils.ts";
import { buildThreadDigest } from "../project/thread-digest.ts";
import { coordinatorInbox, started, useThreadWorld } from "./test-utils.ts";

const { setup } = useThreadWorld();

const APPROVAL = {
  reason: "Approve the production deployment on GitHub",
  link: "https://github.com/get-aop/aop-web/actions/runs/1",
};

const workingThread = async () => {
  const { s, project } = await setup();
  await insertProjectSession(s.db, { id: "isess_w", projectId: project.id, kind: "thread" });
  const read = async (): Promise<Thread> => {
    const found = await s.services.threads.get("isess_w");
    if (!found.success) throw new Error("thread vanished");
    return found.thread;
  };
  return { s, project, read };
};

const waitOf = (thread: Thread) => (thread.status === "working" ? thread.waitingOn : undefined);

describe("a thread that waits on the person without ending its turn", () => {
  test("shows the wait with its reason and link, and tells the coordinator once", async () => {
    const { s, project, read } = await workingThread();

    const result = await s.callTool("isess_w", "aop_report_status", {
      line: "Waiting for the deployment approval",
      waitingOn: APPROVAL,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("You show as waiting on the person");
    const thread = await read();
    expect(thread.status).toBe("working");
    expect(waitOf(thread)).toEqual({ ...APPROVAL, since: expect.any(String) });
    const [report, ...more] = await coordinatorInbox(s, project.id);
    expect(more).toEqual([]);
    expect(report?.content).toBe(
      [
        'Thread report: "isess_w" (isess_w) is waiting on the person for something outside AOP, and keeps working meanwhile: Approve the production deployment on GitHub',
        "Where: https://github.com/get-aop/aop-web/actions/runs/1",
        "Tell the person. The thread clears this itself when it reports again or its turn ends.",
      ].join("\n"),
    );
    expect(parseMessageOrigin(report?.origin_json ?? null)).toEqual({
      type: "thread-report",
      threadId: "isess_w",
      outcome: "needs-you",
    });
  });

  test("the same wait reported again keeps its start and tells nobody again", async () => {
    const { s, project, read } = await workingThread();
    await s.callTool("isess_w", "aop_report_status", { waitingOn: APPROVAL });
    const first = waitOf(await read());

    await s.callTool("isess_w", "aop_report_status", {
      line: "Still waiting",
      waitingOn: APPROVAL,
    });

    expect(waitOf(await read())).toEqual(first);
    expect(await coordinatorInbox(s, project.id)).toHaveLength(1);
  });

  test("a report without the wait clears it", async () => {
    const { s, read } = await workingThread();
    await s.callTool("isess_w", "aop_report_status", { waitingOn: APPROVAL });

    const result = await s.callTool("isess_w", "aop_report_status", { line: "Deploying" });

    expect(result.content[0]?.text).toBe("Status updated.");
    const thread = await read();
    expect(thread.status).toBe("working");
    expect(waitOf(thread)).toBeUndefined();
    expect(thread.liveStatusLine).toBe("Deploying");
  });

  test("refuses a link that is not a web page", async () => {
    const { s, read } = await workingThread();

    const result = await s.callTool("isess_w", "aop_report_status", {
      waitingOn: { reason: "Click it", link: "javascript:alert(1)" },
    });

    expect(result.isError).toBe(true);
    expect(waitOf(await read())).toBeUndefined();
  });

  test("a thread that is not working keeps no wait", async () => {
    const { s, project } = await setup();
    await insertProjectSession(
      s.db,
      { id: "isess_idle", projectId: project.id, kind: "thread" },
      { state: "idle" },
    );

    await s.callTool("isess_idle", "aop_report_status", { line: "Done", waitingOn: APPROVAL });

    const found = await s.services.threads.get("isess_idle");
    expect(found.success && found.thread.status).toBe("idle");
    expect(found.success && "waitingOn" in found.thread).toBe(false);
    expect(await coordinatorInbox(s, project.id)).toEqual([]);
  });

  test("the coordinator sees the wait in its thread list and in each message's digest", async () => {
    const { s, project, read } = await workingThread();
    await s.callTool("isess_w", "aop_report_status", { waitingOn: APPROVAL });
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);

    const listed = await s.callTool(coordinator?.id ?? "", "thread_list", {
      status: "waiting-on-you",
    });

    const { threads } = JSON.parse(listed.content[0]?.text ?? "{}");
    expect(threads).toMatchObject([{ id: "isess_w", status: "working", waitingOn: APPROVAL }]);
    expect(buildThreadDigest([await read()])).toContain(
      '- isess_w "isess_w" [working] waiting on the person: Approve the production deployment on GitHub',
    );
  });

  test("the end of the turn clears the wait", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Deploy",
      prompt: "Deploy [fake: delay=400]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);
    await s.callTool(spawned.thread.id, "aop_report_status", { waitingOn: APPROVAL });
    const waiting = await s.services.threads.get(spawned.thread.id);
    expect(waiting.success && waitOf(waiting.thread)).toBeTruthy();

    await s.settle();

    const ended = await s.services.threads.get(spawned.thread.id);
    expect(ended.success && ended.thread.status).not.toBe("working");
    expect(ended.success && "waitingOn" in ended.thread).toBe(false);
  });
});
