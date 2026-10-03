import { afterEach, describe, expect, test } from "bun:test";
import type { Message, Project, SessionDiffFile, SessionGitDiff, Thread } from "@aop/common";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../project/test-utils.ts";

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async (options: { repos?: number } = {}) => {
  const s = await createProjectStack(home.path(), options);
  stack = s;
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
  });
  return { s, project: created.body.project };
};

const spawn = async (s: ProjectStack, projectId: string, body: Record<string, unknown>) => {
  const response = await s.api<{ thread: Thread }>("POST", `/api/projects/${projectId}/threads`, {
    title: "Work",
    ...body,
  });
  await s.settle();
  return response;
};

describe("starting and listing threads", () => {
  test("POST starts a thread and answers 201 with it; GET lists it and reads it by id", async () => {
    const { s, project } = await setup();

    const started = await spawn(s, project.id, { prompt: "Audit the retries" });
    const listed = await s.api<{ threads: Thread[] }>("GET", `/api/projects/${project.id}/threads`);
    const one = await s.api<{ thread: Thread }>("GET", `/api/threads/${started.body.thread.id}`);

    expect(started.status).toBe(201);
    expect(started.body.thread).toMatchObject({
      title: "Work",
      status: "working",
      repoId: s.repos[0]?.id,
    });
    expect(listed.body.threads.map((thread) => thread.id)).toEqual([started.body.thread.id]);
    expect(one.body.thread.status).toBe("idle");
  });

  test("a bad body is 400, a repo the project lacks is 400 with the choices, an unknown project is 404", async () => {
    const { s, project } = await setup({ repos: 2 });

    const noPrompt = await s.api("POST", `/api/projects/${project.id}/threads`, {});
    const ambiguous = await s.api<{ error: string }>(
      "POST",
      `/api/projects/${project.id}/threads`,
      {
        prompt: "work",
      },
    );
    const foreign = await s.api("POST", `/api/projects/${project.id}/threads`, {
      prompt: "work",
      repoId: "repo_x",
    });
    const unknown = await s.api("POST", "/api/projects/proj_nope/threads", { prompt: "work" });
    const listUnknown = await s.api("GET", "/api/projects/proj_nope/threads");

    expect(noPrompt.status).toBe(400);
    expect(ambiguous).toMatchObject({ status: 400, body: { code: "REPO_REQUIRED" } });
    expect(ambiguous.body.error).toContain(s.repos[1]?.id ?? "");
    expect(foreign).toMatchObject({ status: 400, body: { code: "REPO_NOT_IN_PROJECT" } });
    expect(unknown.status).toBe(404);
    expect(listUnknown.status).toBe(404);
  });

  test("a paused project refuses new threads with 409", async () => {
    const { s, project } = await setup();
    await s.api("POST", `/api/projects/${project.id}/pause`);

    const response = await s.api("POST", `/api/projects/${project.id}/threads`, { prompt: "work" });

    expect(response).toMatchObject({ status: 409, body: { code: "PROJECT_NOT_ACTIVE" } });
  });
});

describe("a thread's transcript, steering and reply", () => {
  test("GET messages shows the relayed brief and the thread's reply as wire messages", async () => {
    const { s, project } = await setup();
    const { body } = await spawn(s, project.id, { prompt: "Audit", quote: "make it safer" });

    const messages = await s.api<{ messages: Message[] }>(
      "GET",
      `/api/threads/${body.thread.id}/messages`,
    );

    expect(messages.body.messages).toMatchObject([
      { role: "user", sender: "coordinator", brief: true, quote: "make it safer", text: "Audit" },
      {
        role: "assistant",
        blocks: [{ type: "text", text: expect.stringContaining("Fake reply") }],
      },
    ]);
  });

  test("GET messages pages back with before and limit, like the coordinator chat", async () => {
    const { s, project } = await setup();
    const { body } = await spawn(s, project.id, { prompt: "Audit" });
    const path = `/api/threads/${body.thread.id}/messages`;

    const newest = await s.api<{ messages: Message[]; hasMore: boolean }>("GET", `${path}?limit=1`);
    const older = await s.api<{ messages: Message[]; hasMore: boolean }>(
      "GET",
      `${path}?limit=1&before=${newest.body.messages[0]?.id}`,
    );
    const unknown = await s.api("GET", `${path}?before=msg_nope`);

    expect(newest.body.messages).toMatchObject([
      { role: "assistant", blocks: [{ text: expect.stringContaining("Fake reply") }] },
    ]);
    expect(newest.body.hasMore).toBe(true);
    expect(older.body.messages).toMatchObject([
      { role: "user", sender: "coordinator", brief: true, text: "Audit" },
    ]);
    expect(older.body.hasMore).toBe(false);
    expect(unknown).toMatchObject({ status: 400, body: { code: "INVALID_MESSAGE" } });
  });

  test("POST messages steers the thread (201); blank text is 400", async () => {
    const { s, project } = await setup();
    const { body } = await spawn(s, project.id, { prompt: "Audit" });

    const steered = await s.api<{ thread: Thread }>(
      "POST",
      `/api/threads/${body.thread.id}/messages`,
      {
        text: "Also the backoff",
      },
    );
    await s.settle();
    const blank = await s.api("POST", `/api/threads/${body.thread.id}/messages`, { text: " " });

    expect(steered.status).toBe(201);
    expect(steered.body.thread.status).toBe("working");
    expect(blank).toMatchObject({ status: 400, body: { code: "INVALID_MESSAGE" } });
    const after = await s.api<{ messages: Message[] }>(
      "GET",
      `/api/threads/${body.thread.id}/messages`,
    );
    expect(after.body.messages).toHaveLength(4);
  });

  test("reply answers a waiting thread and is 409 for one that is not waiting", async () => {
    const { s, project } = await setup();
    const { body } = await spawn(s, project.id, { prompt: "Audit" });

    const notWaiting = await s.api("POST", `/api/threads/${body.thread.id}/reply`, { text: "b" });
    await s.services.threads.askUser(body.thread.id, { question: "Which?", options: [] });
    const replied = await s.api<{ thread: Thread }>(
      "POST",
      `/api/threads/${body.thread.id}/reply`,
      {
        text: "b",
      },
    );
    await s.settle();

    expect(notWaiting).toMatchObject({ status: 409, body: { code: "NOT_WAITING" } });
    expect(replied.status).toBe(200);
    expect(replied.body.thread.status).toBe("working");
    expect(replied.body.thread).not.toHaveProperty("blockedQuestion");
  });
});

describe("stopping, reading and deleting a thread", () => {
  test("stop, read and delete answer with the thread or 204, and unknown ids are 404", async () => {
    const { s, project } = await setup();
    const { body } = await spawn(s, project.id, { prompt: "Audit" });
    const id = body.thread.id;

    const stopped = await s.api<{ thread: Thread }>("POST", `/api/threads/${id}/stop`);
    const read = await s.api<{ thread: Thread }>("POST", `/api/threads/${id}/read`);
    const deleted = await s.api("DELETE", `/api/threads/${id}`);
    const gone = await s.api("GET", `/api/threads/${id}`);

    expect(stopped.body.thread.id).toBe(id);
    expect(read.body.thread.unread).toBe(false);
    expect(deleted.status).toBe(204);
    expect(gone).toMatchObject({ status: 404, body: { code: "THREAD_NOT_FOUND" } });
    for (const [method, path] of [
      ["GET", "/api/threads/isess_nope/messages"],
      ["POST", "/api/threads/isess_nope/stop"],
      ["POST", "/api/threads/isess_nope/read"],
      ["DELETE", "/api/threads/isess_nope"],
    ] as const) {
      expect((await s.api(method, path)).status).toBe(404);
    }
  });
});

describe("what a thread did: its changed files", () => {
  const workingThread = async () => {
    const { s, project } = await setup();
    const { body } = await spawn(s, project.id, {
      prompt: 'Add notes [fake: steps=1 write="notes.md=hello"]',
    });
    return { s, id: body.thread.id };
  };

  test("GET diff lists the file the thread wrote, and diff/file answers its hunks", async () => {
    const { s, id } = await workingThread();

    const summary = await s.api<SessionGitDiff>("GET", `/api/threads/${id}/diff`);
    const file = await s.api<SessionDiffFile>("GET", `/api/threads/${id}/diff/file?path=notes.md`);

    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      defaultBranch: "main",
      summaryOnly: true,
      files: [{ path: "notes.md", status: "added" }],
    });
    expect(file.status).toBe(200);
    expect(file.body).toMatchObject({
      path: "notes.md",
      hunks: [{ lines: [{ type: "add", text: "hello" }] }],
    });
  });

  test("diff/file is 400 for a path that is missing or leaves the worktree, and 404 for one with no change", async () => {
    const { s, id } = await workingThread();

    const missing = await s.api("GET", `/api/threads/${id}/diff/file`);
    const escaping = await s.api("GET", `/api/threads/${id}/diff/file?path=..%2Foutside`);
    const absolute = await s.api("GET", `/api/threads/${id}/diff/file?path=%2Fetc%2Fpasswd`);
    const untouched = await s.api("GET", `/api/threads/${id}/diff/file?path=nothing.md`);

    for (const refused of [missing, escaping, absolute]) {
      expect(refused).toMatchObject({ status: 400, body: { code: "INVALID_PATH" } });
    }
    expect(untouched).toMatchObject({ status: 404, body: { code: "FILE_NOT_FOUND" } });
  });

  test("diff answers 409 with the reason once the thread is resolved and its worktree is gone", async () => {
    const { s, id } = await workingThread();
    await s.api("POST", `/api/threads/${id}/resolve`);

    const summary = await s.api<{ error: string }>("GET", `/api/threads/${id}/diff`);
    const file = await s.api("GET", `/api/threads/${id}/diff/file?path=notes.md`);

    expect(summary).toMatchObject({ status: 409, body: { code: "NO_WORKTREE" } });
    expect(summary.body.error).toBe(
      "The thread has no checkout on disk right now, so there are no changes to show. Its work is kept on its branch.",
    );
    expect(file).toMatchObject({ status: 409, body: { code: "NO_WORKTREE" } });
  });

  test("an unknown thread is 404 on both", async () => {
    const { s } = await setup();

    for (const path of ["diff", "diff/file?path=a.md"]) {
      const response = await s.api("GET", `/api/threads/isess_nope/${path}`);
      expect(response).toMatchObject({ status: 404, body: { code: "THREAD_NOT_FOUND" } });
    }
  });
});
