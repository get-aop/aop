import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { CHAT_IMAGE_LIMITS, type Message, type Project, type Thread } from "@aop/common";
import {
  createProjectStack,
  eventually,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "../project/test-utils.ts";
import { uploadsDir } from "./staging.ts";
import { fakeJpeg, fakePng, upload, uploadRaw } from "./test-utils.ts";

// The upload endpoint, and images on their way through a message: stored with it, served back,
// and handed to the real Claude Code adapter, which gives them to the fake CLI on stdin.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path());
  stack = s;
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  return { s, project: created.project };
};

const staged = (projectId: string): string[] =>
  existsSync(uploadsDir(projectId)) ? readdirSync(uploadsDir(projectId)) : [];

const replyText = (messages: readonly Message[]): string =>
  messages
    .flatMap((message) => (message.role === "assistant" ? message.blocks : []))
    .map((block) => ("text" in block ? block.text : ""))
    .join("\n");

describe("uploading an image", () => {
  test("stores it for the project and names its type from its bytes, not the request", async () => {
    const { s, project } = await setup();

    const { status, body } = await uploadRaw(s, project.id, fakePng(100), "image/jpeg");

    expect(status).toBe(201);
    expect(body.image).toEqual({
      id: expect.stringMatching(/^img_[0-9a-z]{26}$/),
      mimeType: "image/png",
      size: 100,
    });
    expect(staged(project.id)).toEqual([`${(body.image as { id: string }).id}.png`]);
  });

  test("refuses what is not a PNG, JPEG, GIF or WebP image, even labelled as one", async () => {
    const { s, project } = await setup();
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");

    for (const [bytes, type] of [
      [html, "image/png"],
      [svg, "image/svg+xml"],
    ] as const) {
      const { status, body } = await uploadRaw(s, project.id, bytes, type);
      expect(status).toBe(415);
      expect(body).toEqual({
        error: "Use a PNG, JPEG, GIF or WebP image",
        code: "UNSUPPORTED_IMAGE",
      });
    }
    expect(staged(project.id)).toEqual([]);
  });

  test("refuses an empty body and one over the size limit", async () => {
    const { s, project } = await setup();

    const empty = await uploadRaw(s, project.id, new Uint8Array());
    const large = await uploadRaw(s, project.id, fakePng(CHAT_IMAGE_LIMITS.maxBytes + 1));
    const atLimit = await uploadRaw(s, project.id, fakePng(CHAT_IMAGE_LIMITS.maxBytes));

    expect(empty).toEqual({
      status: 400,
      body: { error: "The image is empty", code: "EMPTY_IMAGE" },
    });
    expect(large).toEqual({
      status: 413,
      body: { error: "Images must be 10 MB or smaller", code: "IMAGE_TOO_LARGE" },
    });
    expect(atLimit.status).toBe(201);
    expect(staged(project.id)).toHaveLength(1);
  });

  test("refuses a project that does not exist", async () => {
    const { s } = await setup();

    const { status, body } = await uploadRaw(s, "proj_nope", fakePng());

    expect(status).toBe(404);
    expect(body.code).toBe("PROJECT_NOT_FOUND");
  });
});

describe("a message to the coordinator with images", () => {
  test("is stored with them, hands them to the CLI as images, and serves them back", async () => {
    const { s, project } = await setup();
    const png = await upload(s, project.id, fakePng(321));
    const jpeg = await upload(s, project.id, fakeJpeg(45));

    const sent = await s.api<{ message: Message }>("POST", `/api/projects/${project.id}/messages`, {
      text: "What differs between #image1 and #image2?",
      images: [png.id, jpeg.id],
    });
    await s.settle();

    expect(sent.status).toBe(201);
    // Bun's toMatchObject leaves its matchers in the object it checked, so check a copy.
    const message = sent.body.message;
    expect(structuredClone(message)).toMatchObject({
      role: "user",
      text: "What differs between #image1 and #image2?",
      images: [
        { id: png.id, mimeType: "image/png", path: expect.stringMatching(/\.png$/) },
        { id: jpeg.id, mimeType: "image/jpeg", path: expect.stringMatching(/\.jpg$/) },
      ],
    });
    // The conversation keeps its own copy; the uploads are gone.
    expect(staged(project.id)).toEqual([]);
    expect(s.runs[0]?.images?.map((image) => image.mimeType)).toEqual(["image/png", "image/jpeg"]);

    const listed = await s.api<{ messages: Message[] }>(
      "GET",
      `/api/projects/${project.id}/messages`,
    );
    expect(listed.body.messages[0]).toEqual(message);
    expect(replyText(listed.body.messages)).toContain(
      "[images: image/png (321 bytes), image/jpeg (45 bytes)]",
    );

    const path = message.role === "user" ? (message.images?.[0]?.path ?? "") : "";
    const served = await s.app.request(`/api${path}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await served.arrayBuffer()).equals(Buffer.from(fakePng(321)))).toBe(true);
    // The Library can remove a sent image, so the browser revalidates instead of caching it.
    expect(served.headers.get("cache-control")).toBe("private, no-cache");
    const again = await s.app.request(`/api${path}`, {
      headers: { "If-None-Match": served.headers.get("etag") ?? "" },
    });
    expect(again.status).toBe(304);
  });

  test("may be images alone", async () => {
    const { s, project } = await setup();
    const png = await upload(s, project.id);

    const sent = await s.api<{ message: Message }>("POST", `/api/projects/${project.id}/messages`, {
      text: "",
      images: [png.id],
    });
    await s.settle();

    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ role: "user", text: "", images: [{ id: png.id }] });
    expect(s.runs).toHaveLength(1);
  });

  test("an image that is not a waiting upload, or too many, refuses the message and runs nothing", async () => {
    const { s, project } = await setup();
    const ids = await Promise.all(
      Array.from({ length: CHAT_IMAGE_LIMITS.maxCount + 1 }, () => upload(s, project.id)),
    );

    const unknown = await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: "look",
      images: ["img_01k0000000000000000000000z"],
    });
    const tooMany = await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: "look",
      images: ids.map((image) => image.id),
    });

    expect(unknown).toEqual({
      status: 400,
      body: {
        error: "An attached image is no longer on the host; attach it again",
        code: "INVALID_MESSAGE",
      },
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toBe("Attach at most 5 images to a message");
    expect(s.runs).toEqual([]);
    // Nothing was sent, so the uploads wait for the person to try again.
    expect(staged(project.id)).toHaveLength(ids.length);
  });

  test("an image is served only through its own project", async () => {
    const { s, project } = await setup();
    const other = await s.services.projects.create(projectSettings({ name: "Other", repoIds: [] }));
    if (!other.success) throw new Error("project not created");
    const png = await upload(s, project.id);
    const sent = await s.api<{ message: Message }>("POST", `/api/projects/${project.id}/messages`, {
      text: "keep this",
      images: [png.id],
    });
    await s.settle();
    const fileName =
      sent.body.message.role === "user"
        ? (sent.body.message.images?.[0]?.path.split("/").at(-1) ?? "")
        : "";

    const elsewhere = await s.app.request(`/api/projects/${other.project.id}/images/${fileName}`);
    const traversal = await s.app.request(
      `/api/projects/${project.id}/images/${encodeURIComponent("../../aop.sqlite")}`,
    );
    const unknown = await s.app.request(
      `/api/projects/${project.id}/images/smsg_01k0000000000000000000000z-1.png`,
    );

    expect([elsewhere.status, traversal.status, unknown.status]).toEqual([404, 404, 404]);
  });
});

describe("a message to a thread with images", () => {
  const spawnIdle = async (s: ProjectStack, project: Project, prompt: string): Promise<Thread> => {
    const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt });
    if (!spawned.success) throw new Error("thread not spawned");
    return spawned.thread;
  };

  const threadMessages = async (s: ProjectStack, threadId: string): Promise<Message[]> =>
    (await s.api<{ messages: Message[] }>("GET", `/api/threads/${threadId}/messages`)).body
      .messages;

  test("steering an idle thread starts a turn that sees them", async () => {
    const { s, project } = await setup();
    const thread = await spawnIdle(s, project, "Do it");
    await s.settle();
    const png = await upload(s, project.id, fakePng(77));

    const sent = await s.api("POST", `/api/threads/${thread.id}/messages`, {
      text: "Match this mockup",
      images: [png.id],
    });
    await s.settle();

    expect(sent.status).toBe(201);
    const messages = await threadMessages(s, thread.id);
    expect(messages.find((message) => message.role === "user")).toMatchObject({
      text: "Match this mockup",
      images: [{ id: png.id, mimeType: "image/png" }],
    });
    expect(replyText(messages)).toContain(
      "You said: Match this mockup [images: image/png (77 bytes)]",
    );
    // The thread resumed its own session for the turn with the image.
    expect(s.runs.at(-1)?.resumeSessionId).toBeDefined();
  });

  test("a message sent into a working thread's turn takes its images into that turn", async () => {
    const { s, project } = await setup();
    const thread = await spawnIdle(s, project, "Do it [fake: steps=3 delay=200]");
    await eventually(
      async () =>
        (await s.ctx.chatSessionRepository.getById(thread.id))?.runtime_session_id ?? undefined,
      "the first turn's CLI to start",
    );
    const jpeg = await upload(s, project.id, fakeJpeg(99));

    const sent = await s.api("POST", `/api/threads/${thread.id}/messages`, {
      text: "Match this",
      images: [jpeg.id],
    });
    await s.settle();

    expect(sent.status).toBe(201);
    const threadRuns = s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === thread.id);
    expect(threadRuns).toHaveLength(1);
    expect(replyText(await threadMessages(s, thread.id))).toContain(
      "Then you said: Match this [images: image/jpeg (99 bytes)]",
    );
  });

  test("a message held for after the turn keeps its images for the turn it starts", async () => {
    const { s, project } = await setup();
    const thread = await spawnIdle(s, project, "Do it [fake: steps=2 delay=150]");
    await eventually(async () => (s.runs.length > 0 ? true : undefined), "the first turn to start");
    const jpeg = await upload(s, project.id, fakeJpeg(99));

    const sent = await s.api("POST", `/api/threads/${thread.id}/messages`, {
      text: "",
      images: [jpeg.id],
      midRunMode: "queue",
    });
    await s.settle();

    expect(sent.status).toBe(201);
    // A finished turn also reports to the coordinator, whose runs are not the thread's.
    const threadRuns = s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === thread.id);
    expect(threadRuns).toHaveLength(2);
    expect(threadRuns[0]?.images).toBeUndefined();
    expect(threadRuns[1]?.images?.map((image) => image.mimeType)).toEqual(["image/jpeg"]);
    expect(replyText(await threadMessages(s, thread.id))).toContain(
      "[images: image/jpeg (99 bytes)]",
    );
  });
});
