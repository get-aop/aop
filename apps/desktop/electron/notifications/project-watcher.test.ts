import { describe, expect, test } from "bun:test";
import { createManualScheduler, flush } from "../connection/test-utils";
import { createFakeHost } from "./fake-host";
import { INBOX_POLL_MS } from "./inbox-poll";
import { type NotificationIntent, notificationPath } from "./policy";
import { createProjectWatcher, MAX_WATCHED_PROJECTS, type WatchTarget } from "./project-watcher";
import {
  coordinatorPost,
  entryFor,
  makeProject,
  makeThread,
  NOW,
  threadReport,
  waitingThread,
} from "./test-utils";

// The watcher also re-reads the project list once a minute; that timer is not a reconnect.
// The project list's refresh and the Inbox's queue read run on their own steady timers.
const retryDelays = (clock: ReturnType<typeof createManualScheduler>): number[] =>
  clock.waiting().filter((delay) => delay !== 60_000 && delay !== INBOX_POLL_MS);

const TARGET: WatchTarget = { baseUrl: "https://mac.tail1234.ts.net", token: "aop_t" };

const setup = (options: { focused?: boolean } = {}) => {
  const fake = createFakeHost();
  const clock = createManualScheduler();
  const notifications: NotificationIntent[] = [];
  const watcher = createProjectWatcher({
    fetch: fake.fetch,
    notify: (intent) => notifications.push(intent),
    isAppFocused: () => options.focused ?? false,
    now: () => NOW,
    schedule: clock.schedule,
  });
  const started = async (target: WatchTarget = TARGET) => {
    watcher.start(target);
    await flush();
    await flush();
  };
  return { fake, clock, notifications, watcher, started };
};

describe("following a host", () => {
  test("opens a stream for each active project, as the device, and no others", async () => {
    const { fake, started } = setup();
    fake.host.projects = [
      makeProject({ id: "prj_1" }),
      makeProject({ id: "prj_2" }),
      makeProject({ id: "prj_paused", status: "paused" }),
      makeProject({ id: "prj_old", status: "archived" }),
    ];

    await started();

    expect(fake.host.streams.map((stream) => stream.projectId).sort()).toEqual(["prj_1", "prj_2"]);
    expect(fake.host.streams[0]?.headers.authorization).toBe("Bearer aop_t");
    expect(fake.host.streams[0]?.url).toBe(
      `/api/projects/${fake.host.streams[0]?.projectId}/stream`,
    );
  });

  test("sends no header for the host on this Mac", async () => {
    const { fake, started } = setup();
    fake.host.token = null;
    fake.host.projects = [makeProject()];

    await started({ baseUrl: "http://127.0.0.1:25150", token: null });

    expect(fake.host.streams).toHaveLength(1);
    expect(fake.host.streams[0]?.headers.authorization).toBeUndefined();
  });

  test("follows no more projects than it is allowed to", async () => {
    const { fake, started } = setup();
    fake.host.projects = Array.from({ length: MAX_WATCHED_PROJECTS + 4 }, (_, index) =>
      makeProject({ id: `prj_${index}` }),
    );

    await started();

    expect(fake.host.streams).toHaveLength(MAX_WATCHED_PROJECTS);
  });

  test("picks up a project created later, and lets go of one that is archived", async () => {
    const { fake, clock, started } = setup();
    fake.host.projects = [makeProject({ id: "prj_1" })];
    await started();

    fake.host.projects = [
      makeProject({ id: "prj_1", status: "archived" }),
      makeProject({ id: "prj_2" }),
    ];
    clock.fire();
    await flush();
    await flush();

    expect(fake.streamFor("prj_2")).toHaveLength(1);
    expect(fake.streamFor("prj_1")[0]?.aborted()).toBe(true);
    expect(fake.streamFor("prj_2")[0]?.aborted()).toBe(false);
  });

  test("stops for good when the host does not know this device", async () => {
    const { fake, clock, notifications, watcher, started } = setup();
    fake.host.projects = [makeProject()];
    await started({ ...TARGET, token: "aop_revoked" });

    expect(fake.host.streams).toHaveLength(0);
    clock.fire();
    await flush();

    expect(fake.host.streams).toHaveLength(0);
    expect(notifications).toEqual([]);
    watcher.stop();
  });

  test("stops following when told to, and does not reconnect", async () => {
    const { fake, clock, watcher, started } = setup();
    fake.host.projects = [makeProject()];
    await started();

    watcher.stop();
    await flush();
    clock.fire();
    await flush();

    expect(fake.host.streams).toHaveLength(1);
    expect(clock.waiting()).toEqual([]);
    expect(fake.host.streams[0]?.aborted()).toBe(true);
  });

  test("drops a project the host no longer has", async () => {
    const { fake, clock, started } = setup();
    fake.host.projects = [makeProject()];
    fake.host.streamStatus.prj_1 = 404;
    await started();
    fake.host.streamStatus = {};

    clock.fire();
    await flush();
    await flush();

    expect(fake.host.streams).toHaveLength(1);
  });
});

describe("what it announces", () => {
  const follow = async (options?: { focused?: boolean }) => {
    const context = setup(options);
    context.fake.host.projects = [makeProject()];
    context.fake.host.threads.prj_1 = [makeThread()];
    await context.started();
    return { ...context, stream: context.fake.host.streams[0] };
  };

  test("a thread that starts needing the person", async () => {
    const { notifications, stream } = await follow();

    stream?.entry(entryFor({ thread: waitingThread("Which region?") }));
    await flush();

    expect(notifications).toEqual([
      {
        kind: "needs-you",
        title: "checkout-service",
        body: "Fix the cold start · Which region?",
        target: { projectId: "prj_1", threadId: "thr_1" },
      },
    ]);
  });

  test("does not announce a thread that was already waiting when the app connected", async () => {
    const context = setup();
    const asking = waitingThread("Which region?");
    context.fake.host.projects = [makeProject()];
    context.fake.host.threads.prj_1 = [asking];
    await context.started();

    context.fake.host.streams[0]?.entry(entryFor({ thread: { ...asking, unread: true } }));
    await flush();

    expect(context.notifications).toEqual([]);
  });

  test("a coordinator post and a failed thread", async () => {
    const { notifications, stream } = await follow();

    stream?.entry(entryFor({ message: coordinatorPost("Two threads are running.") }));
    stream?.entry(entryFor({ message: threadReport("failed", "The build broke.") }));
    await flush();

    expect(notifications.map((n) => [n.kind, n.body])).toEqual([
      ["coordinator", "Two threads are running."],
      ["thread-error", "Fix the cold start failed: The build broke."],
    ]);
  });

  test("nothing while the person is looking at the app", async () => {
    const { notifications, stream } = await follow({ focused: true });

    stream?.entry(entryFor({ thread: waitingThread() }));
    await flush();

    expect(notifications).toEqual([]);
  });

  test("follows the project's notification level as the person changes it", async () => {
    const { notifications, stream } = await follow();

    stream?.entry(entryFor({ project: makeProject({ notificationLevel: "off" }) }));
    stream?.entry(entryFor({ message: coordinatorPost("Quiet, please.") }));
    stream?.entry(entryFor({ project: makeProject({ notificationLevel: "every-turn" }) }));
    stream?.entry(entryFor({ message: threadReport("finished") }));
    await flush();

    expect(notifications.map((n) => n.kind)).toEqual(["turn-finished"]);
  });

  test("a thread that is deleted is forgotten, so a new one with its id announces itself", async () => {
    const { notifications, stream } = await follow();

    stream?.entry(entryFor({ thread: waitingThread("First?") }));
    stream?.entry(entryFor({ threadId: "thr_1" }));
    stream?.entry(entryFor({ thread: waitingThread("First?") }));
    await flush();

    expect(notifications).toHaveLength(2);
  });

  test("an entry that arrives before the thread list is compared with that list", async () => {
    const context = setup();
    context.fake.host.projects = [makeProject()];
    context.fake.host.threads.prj_1 = [makeThread()];
    context.watcher.start(TARGET);
    await flush();
    const stream = context.fake.host.streams[0];

    // Written in the same tick the stream opened, before the thread list has been read.
    stream?.entry(entryFor({ thread: waitingThread("Which region?") }));
    await flush();
    await flush();

    expect(context.notifications.map((n) => n.kind)).toEqual(["needs-you"]);
  });

  test("ignores a frame it cannot read instead of dying", async () => {
    const { notifications, stream } = await follow();

    stream?.raw("event: entry\ndata: {not json\n\n");
    stream?.raw('event: entry\ndata: {"id":9,"type":"nonsense"}\n\n');
    stream?.raw("event: something-new\ndata: {}\n\n");
    stream?.entry(entryFor({ thread: waitingThread() }));
    await flush();

    expect(notifications).toHaveLength(1);
  });
});

describe("staying connected", () => {
  test("reconnects from where it left off, and announces what it missed once", async () => {
    const { fake, clock, notifications, started } = setup();
    fake.host.projects = [makeProject()];
    fake.host.threads.prj_1 = [makeThread()];
    await started();
    const first = fake.host.streams[0];
    first?.entry(entryFor({ message: coordinatorPost("One.") }, 7));
    await flush();

    first?.end();
    await flush();
    expect(retryDelays(clock)).toEqual([1_000]);
    clock.fire();
    await flush();
    await flush();

    const second = fake.host.streams[1];
    expect(second?.url).toBe("/api/projects/prj_1/stream?after=7");
    // The host replays what came after the cursor; an entry at or below it is not new.
    second?.entry(entryFor({ message: coordinatorPost("One.") }, 7));
    second?.entry(entryFor({ thread: waitingThread("While away?") }, 8));
    await flush();

    expect(notifications.map((n) => n.kind)).toEqual(["coordinator", "needs-you"]);
  });

  test("keeps the thread list it had across a reconnect, so a change while away still reads as a change", async () => {
    const { fake, clock, started } = setup();
    fake.host.projects = [makeProject()];
    fake.host.threads.prj_1 = [makeThread()];
    await started();
    const threadListReads = () => fake.host.requests.filter((r) => r.endsWith("/threads")).length;
    expect(threadListReads()).toBe(1);

    fake.host.streams[0]?.end();
    await flush();
    clock.fire();
    await flush();
    await flush();

    expect(threadListReads()).toBe(1);
  });

  test("backs off while the host keeps failing, and starts over once a stream opens", async () => {
    const { fake, clock, started } = setup();
    fake.host.projects = [makeProject()];
    fake.host.streamStatus.prj_1 = 503;
    await started();

    const delays: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      delays.push(...retryDelays(clock));
      clock.fire();
      await flush();
      await flush();
    }

    expect(delays.slice(0, 3)).toEqual([1_000, 2_000, 5_000]);
  });

  test("a resync tells it to read the thread list again", async () => {
    const { fake, started } = setup();
    fake.host.projects = [makeProject()];
    fake.host.threads.prj_1 = [makeThread()];
    await started();

    fake.host.threads.prj_1 = [makeThread(), makeThread({ id: "thr_2", title: "Second" })];
    fake.host.streams[0]?.resync(12);
    await flush();
    await flush();

    expect(fake.host.requests.filter((r) => r.endsWith("/threads"))).toHaveLength(2);
  });
});

describe("the Inbox's notifications", () => {
  const queued = (seq: number, itemId: string) => ({
    seq,
    itemId,
    title: "Priya Rao in #infra",
    body: "@Marcelo can you take the deploy check?",
  });

  test("shows what the host queued after it started reading, and opens the item", async () => {
    const { fake, clock, notifications, started } = setup();
    fake.host.inbox = [queued(1, "inbx_old")];
    await started();
    expect(fake.host.requests).toContain("/api/inbox/notifications");
    expect(notifications).toEqual([]);

    fake.host.inbox.push(queued(2, "inbx_new"));
    clock.fire();
    await flush();
    await flush();

    expect(fake.host.requests).toContain("/api/inbox/notifications?after=1");
    expect(notifications).toEqual([
      {
        kind: "inbox",
        title: "Priya Rao in #infra",
        body: "@Marcelo can you take the deploy check?",
        target: { inboxItemId: "inbx_new" },
      },
    ]);
    expect(notificationPath({ inboxItemId: "inbx_new" })).toBe("/inbox/inbx_new");
  });

  test("stays quiet while the app is in front", async () => {
    const { fake, clock, notifications, started } = setup({ focused: true });
    await started();
    fake.host.inbox.push(queued(1, "inbx_1"));
    clock.fire();
    await flush();
    await flush();
    expect(notifications).toEqual([]);
  });
});
