import { afterEach, describe, expect, test } from "bun:test";
import type { Message, Project } from "@aop/common";
import { createProjectStack, type ProjectStack, useTempAopHome } from "./test-utils.ts";

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

describe("POST /api/projects", () => {
  test("creates a project from just a name, with Claude Projects' defaults", async () => {
    const s = await createProjectStack(home.path());
    stack = s;

    const response = await s.api<{ project: Project }>("POST", "/api/projects", {
      name: " Checkout ",
    });

    expect(response.status).toBe(201);
    expect(response.body.project).toMatchObject({
      name: "Checkout",
      goal: "",
      instructions: "",
      status: "active",
      coordinator: { provider: "claude-code", model: null, effort: "low" },
      thread: { provider: "claude-code", model: null, effort: "high" },
      notificationLevel: "coordinator",
      threadAccess: "auto-accept-edits",
      repoIds: [],
    });
    expect(response.body.project.id).toStartWith("proj_");
  });

  test("answers 400 with the issues for a bad body", async () => {
    const s = await createProjectStack(home.path());
    stack = s;

    const noName = await s.api<{ error: string; details: { path: string[] }[] }>(
      "POST",
      "/api/projects",
      {},
    );
    const tooLong = await s.api("POST", "/api/projects", {
      name: "x",
      instructions: "i".repeat(16_001),
    });
    const provider = await s.api("POST", "/api/projects", {
      name: "x",
      coordinator: { provider: "codex-cli", model: null, effort: null },
    });

    expect(noName.status).toBe(400);
    expect(noName.body.details[0]?.path).toEqual(["name"]);
    expect(tooLong.status).toBe(400);
    expect(provider.status).toBe(400);
  });

  test("answers 404 for a repo that is not registered, and creates nothing", async () => {
    const s = await createProjectStack(home.path());
    stack = s;

    const response = await s.api("POST", "/api/projects", { name: "x", repoIds: ["repo_nope"] });

    expect(response).toMatchObject({ status: 404, body: { code: "REPO_NOT_FOUND" } });
    expect((await s.api<{ projects: unknown[] }>("GET", "/api/projects")).body.projects).toEqual(
      [],
    );
  });
});

describe("reading and changing a project", () => {
  test("lists and gets projects; an unknown id is 404", async () => {
    const { s, project } = await setup();

    const list = await s.api<{ projects: Project[] }>("GET", "/api/projects");
    const one = await s.api<{ project: Project }>("GET", `/api/projects/${project.id}`);
    const missing = await s.api("GET", "/api/projects/proj_nope");

    expect(list.body.projects.map((item) => item.id)).toEqual([project.id]);
    expect(one.body.project).toEqual(project);
    expect(missing).toMatchObject({ status: 404, body: { code: "PROJECT_NOT_FOUND" } });
  });

  test("PATCH changes the settings sent; an empty patch and bad values are 400", async () => {
    const { s, project } = await setup();

    const changed = await s.api<{ project: Project }>("PATCH", `/api/projects/${project.id}`, {
      goal: "Ship v2",
      threadAccess: "full-access",
    });
    const empty = await s.api("PATCH", `/api/projects/${project.id}`, {});
    const bad = await s.api("PATCH", `/api/projects/${project.id}`, { threadAccess: "root" });

    expect(changed.body.project).toMatchObject({
      goal: "Ship v2",
      threadAccess: "full-access",
      name: "Checkout",
    });
    expect(empty.status).toBe(400);
    expect(bad.status).toBe(400);
  });

  test("status is not editable through PATCH; pause, resume, archive and restore change it", async () => {
    const { s, project } = await setup();

    const ignored = await s.api("PATCH", `/api/projects/${project.id}`, { status: "archived" });
    const paused = await s.api<{ project: Project }>("POST", `/api/projects/${project.id}/pause`);
    const badRestore = await s.api("POST", `/api/projects/${project.id}/restore`);
    const resumed = await s.api<{ project: Project }>("POST", `/api/projects/${project.id}/resume`);
    const archived = await s.api<{ project: Project }>(
      "POST",
      `/api/projects/${project.id}/archive`,
    );
    const badPause = await s.api("POST", `/api/projects/${project.id}/pause`);
    const restored = await s.api<{ project: Project }>(
      "POST",
      `/api/projects/${project.id}/restore`,
    );

    expect(ignored.status).toBe(400);
    expect(paused.body.project.status).toBe("paused");
    expect(badRestore).toMatchObject({ status: 409, body: { code: "INVALID_TRANSITION" } });
    expect(resumed.body.project.status).toBe("active");
    expect(archived.body.project.status).toBe("archived");
    expect(badPause).toMatchObject({ status: 409, body: { code: "INVALID_TRANSITION" } });
    expect(restored.body.project.status).toBe("active");
  });

  test("restarting the coordinator and deleting the project", async () => {
    const { s, project } = await setup();

    const restarted = await s.api<{ project: Project }>(
      "POST",
      `/api/projects/${project.id}/coordinator/restart`,
    );
    const deleted = await s.api("DELETE", `/api/projects/${project.id}`);
    const gone = await s.api("GET", `/api/projects/${project.id}`);
    const deletedAgain = await s.api("DELETE", `/api/projects/${project.id}`);

    expect(restarted.body.project.id).toBe(project.id);
    expect(deleted.status).toBe(204);
    expect(gone.status).toBe(404);
    expect(deletedAgain.status).toBe(404);
  });
});

describe("the coordinator chat", () => {
  test("a message is 201 with the wire user message, and the coordinator's reply follows", async () => {
    const { s, project } = await setup();

    const sent = await s.api<{ message: Message }>("POST", `/api/projects/${project.id}/messages`, {
      text: "hello",
    });
    await s.settle();
    const listed = await s.api<{ messages: Message[] }>(
      "GET",
      `/api/projects/${project.id}/messages`,
    );

    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ role: "user", text: "hello", threadId: null });
    expect(listed.body.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  test("blank text is 400, a paused project is 409, an unknown project is 404", async () => {
    const { s, project } = await setup();

    const blank = await s.api("POST", `/api/projects/${project.id}/messages`, { text: "  " });
    const noBody = await s.api("POST", `/api/projects/${project.id}/messages`, {});
    await s.api("POST", `/api/projects/${project.id}/pause`);
    const paused = await s.api("POST", `/api/projects/${project.id}/messages`, { text: "hi" });
    const unknown = await s.api("POST", "/api/projects/proj_nope/messages", { text: "hi" });

    expect(blank).toMatchObject({ status: 400, body: { code: "INVALID_MESSAGE" } });
    expect(noBody.status).toBe(400);
    expect(paused).toMatchObject({ status: 409, body: { code: "PROJECT_NOT_ACTIVE" } });
    expect(unknown.status).toBe(404);
  });
});

describe("project memory", () => {
  test("writes, lists with the index first, reads and deletes files", async () => {
    const { s, project } = await setup();
    const base = `/api/projects/${project.id}/memory`;

    const topic = await s.api("PUT", `${base}/payments.md`, {
      description: "Payment rules",
      body: "append-only",
    });
    const index = await s.api("PUT", `${base}/MEMORY.md`, { body: "- payments.md" });
    const listed = await s.api<{ files: { name: string }[] }>("GET", base);
    const read = await s.api<{ file: { body: string; description: string } }>(
      "GET",
      `${base}/payments.md`,
    );
    const removed = await s.api("DELETE", `${base}/payments.md`);
    const removedAgain = await s.api("DELETE", `${base}/payments.md`);
    const gone = await s.api("GET", `${base}/payments.md`);

    expect(topic.status).toBe(200);
    expect(index.status).toBe(200);
    expect(listed.body.files.map((file) => file.name)).toEqual(["MEMORY.md", "payments.md"]);
    expect(read.body.file).toMatchObject({ body: "append-only", description: "Payment rules" });
    expect(removed.status).toBe(204);
    expect(removedAgain.status).toBe(404);
    expect(gone.status).toBe(404);
  });

  test("a bad file name or body is 400 and an unknown project is 404", async () => {
    const { s, project } = await setup();

    const badName = await s.api("PUT", `/api/projects/${project.id}/memory/notes.txt`, {
      body: "x",
    });
    const noBody = await s.api("PUT", `/api/projects/${project.id}/memory/notes.md`, {});
    const unknown = await s.api("GET", "/api/projects/proj_nope/memory");

    expect(badName.status).toBe(400);
    expect(noBody.status).toBe(400);
    expect(unknown.status).toBe(404);
  });
});
