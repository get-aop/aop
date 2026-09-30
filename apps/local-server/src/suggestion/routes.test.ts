import { describe, expect, test } from "bun:test";
import type { Message, Thread } from "@aop/common";
import { openSse } from "../event-log/sse-test-client.ts";
import { serveEventStream } from "../event-log/test-utils.ts";
import { useThreadWorld } from "../thread/test-utils.ts";
import { answersIn, countThreads, proposeThreads } from "./test-utils.ts";

const { setup } = useThreadWorld();

const proposals = [
  { title: "Add retry metrics", prompt: "Add a metric to every retry.", repoId: null },
  { title: "Load test checkout", prompt: "Load test it.", repoId: null },
];

const urlOf = (projectId: string, messageId: string, suggestionId: string, action: string) =>
  `/api/projects/${projectId}/messages/${messageId}/suggestions/${suggestionId}/${action}`;

describe("POST .../suggestions/:suggestionId/start", () => {
  test("starts the thread with 201, and answers 200 with the same thread when it is asked again", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals);
    const url = urlOf(project.id, proposal.messageId, proposal.suggestions[0]?.id ?? "", "start");

    const first = await s.api<{ thread: Thread }>("POST", url);
    await s.settle();
    const second = await s.api<{ thread: Thread }>("POST", url);

    expect(first.status).toBe(201);
    expect(first.body.thread).toMatchObject({ title: "Add retry metrics", projectId: project.id });
    expect(second.status).toBe(200);
    expect(second.body.thread.id).toBe(first.body.thread.id);
    expect(await countThreads(s, project.id)).toBe(1);
  });

  test("two clients starting the same proposal at once get one thread between them", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals);
    const url = urlOf(project.id, proposal.messageId, proposal.suggestions[0]?.id ?? "", "start");

    const [a, b] = await Promise.all([
      s.api<{ thread: Thread }>("POST", url),
      s.api<{ thread: Thread }>("POST", url),
    ]);
    await s.settle();

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.thread.id).toBe(b.body.thread.id);
    expect(await countThreads(s, project.id)).toBe(1);
  });

  test("answers 409 for a paused project, and 404 for what is not there", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals);
    const id = proposal.suggestions[0]?.id ?? "";
    await s.services.projects.transition(project.id, "pause");

    const paused = await s.api("POST", urlOf(project.id, proposal.messageId, id, "start"));
    const noMessage = await s.api("POST", urlOf(project.id, "msg_nope", id, "start"));
    const noSuggestion = await s.api(
      "POST",
      urlOf(project.id, proposal.messageId, "nope", "start"),
    );
    const noProject = await s.api("POST", urlOf("proj_nope", proposal.messageId, id, "start"));

    expect(paused).toMatchObject({ status: 409, body: { code: "PROJECT_NOT_ACTIVE" } });
    expect(noMessage).toMatchObject({ status: 404, body: { code: "SUGGESTION_NOT_FOUND" } });
    expect(noSuggestion).toMatchObject({ status: 404, body: { code: "SUGGESTION_NOT_FOUND" } });
    expect(noProject).toMatchObject({ status: 404, body: { code: "PROJECT_NOT_FOUND" } });
    expect(await countThreads(s, project.id)).toBe(0);
  });
});

describe("skipping over HTTP", () => {
  test("POST records the skip, DELETE takes it back, and the message a client fetches carries the answer", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals);
    const url = urlOf(project.id, proposal.messageId, proposal.suggestions[1]?.id ?? "", "skip");
    const listed = async () => {
      const { body } = await s.api<{ messages: Message[] }>(
        "GET",
        `/api/projects/${project.id}/messages`,
      );
      return answersIn(body.messages.find(({ id }) => id === proposal.messageId));
    };

    const skipped = await s.api("POST", url);
    const whileSkipped = await listed();
    const undone = await s.api("DELETE", url);
    const afterUndo = await listed();

    expect(skipped).toMatchObject({ status: 200, body: { answer: { state: "skipped" } } });
    expect(whileSkipped).toEqual([null, { state: "skipped" }]);
    expect(undone).toMatchObject({ status: 200, body: { answer: null } });
    expect(afterUndo).toEqual([null, null]);
  });

  test("answers 404 for a suggestion that is not in the message", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals);

    const response = await s.api("POST", urlOf(project.id, proposal.messageId, "nope", "skip"));

    expect(response).toMatchObject({ status: 404, body: { code: "SUGGESTION_NOT_FOUND" } });
  });
});

describe("what a second client hears", () => {
  test("its stream carries the message with the answer, and the thread before it", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals);
    const [start, skip] = proposal.suggestions;
    const stream = serveEventStream(s.ctx);
    const other = await openSse(stream.streamUrl(project.id, "?after=0"));
    try {
      await s.api("POST", urlOf(project.id, proposal.messageId, skip?.id ?? "", "skip"));
      const started = await s.api<{ thread: Thread }>(
        "POST",
        urlOf(project.id, proposal.messageId, start?.id ?? "", "start"),
      );
      await s.settle();

      await other.waitFor((frame) => frame.data.includes('"state":"started"'));
      const updates = other
        .entries()
        .flatMap((entry) => (entry.type === "message.updated" ? [entry] : []));
      expect(updates.map((entry) => answersIn(entry.payload.message))).toEqual([
        [null, { state: "skipped" }],
        [{ state: "started", threadId: started.body.thread.id }, { state: "skipped" }],
      ]);
      const types = other.entries().map((entry) => entry.type);
      expect(types.indexOf("thread.upserted")).toBeLessThan(types.lastIndexOf("message.updated"));
    } finally {
      other.close();
      await stream.stop();
    }
  });
});
