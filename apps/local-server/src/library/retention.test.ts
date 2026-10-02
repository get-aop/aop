import { afterEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { existsSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LibraryItem, Message } from "@aop/common";
import { fakePng, upload } from "../attachment/test-utils.ts";
import type { ChatSession } from "../db/schema.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../project/test-utils.ts";
import { SettingKey } from "../settings/types.ts";
import { ORPHAN_GRACE_MS, runLibraryRetention, startLibraryRetention } from "./retention.ts";
import { libraryDir, putBlob } from "./store.ts";
import { createLibraryProject, filler, getListing, uploadFile } from "./test-utils.ts";

// The daily cleanup, with the clock moved by hand: what arrived on its own goes after the
// retention period or under cap pressure, what the person added or pinned stays, and a sent
// image that goes leaves its message a "file expired" answer instead of a broken image.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-01T09:00:00.000Z");
const at = (days: number): Date => new Date(T0.getTime() + days * DAY);

afterEach(async () => {
  setSystemTime();
  jest.useRealTimers();
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path(), { repos: 0 });
  stack = s;
  const { projectId, coordinator } = await createLibraryProject(s);
  return { s, projectId, coordinator };
};

const saveArtifact = async (
  s: ProjectStack,
  session: ChatSession,
  name: string,
  content: string,
): Promise<LibraryItem> => {
  const saved = await s.services.library.saveFromAgent(session, { content, name });
  if (!saved.success) throw new Error(`save failed: ${saved.error.code}`);
  return saved.item;
};

const names = async (s: ProjectStack, projectId: string): Promise<string[]> =>
  (await getListing(s, projectId)).items.map((item) => item.name).sort();

const blobCount = (projectId: string): number => {
  const dir = join(libraryDir(projectId), "blobs");
  return existsSync(dir) ? readdirSync(dir).length : 0;
};

/** Sends the coordinator a message with one image, the way the dashboard does. */
const sendImage = async (s: ProjectStack, projectId: string): Promise<string> => {
  const image = await upload(s, projectId, fakePng(256));
  const sent = await s.api<{ message: Message }>("POST", `/api/projects/${projectId}/messages`, {
    text: "Here is the screenshot",
    images: [image.id],
  });
  await s.settle();
  const message = sent.body.message;
  return message.role === "user" ? (message.images?.[0]?.path ?? "") : "";
};

describe("retention by age", () => {
  test("removes automatic items after the period, keeps uploads and pinned items, and is idempotent", async () => {
    const { s, projectId, coordinator } = await setup();
    setSystemTime(T0);
    const report = await saveArtifact(s, coordinator, "report.md", "# Report");
    const kept = await saveArtifact(s, coordinator, "keep.md", "# Keep");
    await s.services.library.update(projectId, kept.id, { pinned: true });
    await uploadFile(s, projectId, "upload.txt", "mine");
    expect(report.expiresAt).toBe(at(30).toISOString());

    expect(await runLibraryRetention(s.ctx, at(29))).toEqual({
      indexed: 0,
      expired: 0,
      evicted: 0,
      orphans: 0,
    });
    expect(await names(s, projectId)).toEqual(["keep.md", "report.md", "upload.txt"]);

    setSystemTime(at(31));
    const first = await runLibraryRetention(s.ctx);
    const second = await runLibraryRetention(s.ctx);

    expect(first.expired).toBe(1);
    expect(second).toEqual({ indexed: 0, expired: 0, evicted: 0, orphans: 0 });
    expect(await names(s, projectId)).toEqual(["keep.md", "upload.txt"]);
    expect(blobCount(projectId)).toBe(2);
  });

  test("a project's own period wins over the host's, and 0 keeps everything", async () => {
    const { s, projectId, coordinator } = await setup();
    setSystemTime(T0);
    await saveArtifact(s, coordinator, "a.md", "a");
    await s.api("PUT", `/api/projects/${projectId}/library/settings`, {
      retentionDays: 0,
      capMb: null,
    });

    expect((await runLibraryRetention(s.ctx, at(400))).expired).toBe(0);

    await s.api("PUT", `/api/projects/${projectId}/library/settings`, {
      retentionDays: 7,
      capMb: null,
    });
    expect((await runLibraryRetention(s.ctx, at(8))).expired).toBe(1);
  });
});

describe("a sent image", () => {
  test("is in the Library under Sent in chat, linked to its message", async () => {
    const { s, projectId } = await setup();

    await sendImage(s, projectId);

    const [item] = (await getListing(s, projectId)).items;
    expect(item).toMatchObject({
      source: "chat",
      folder: "Sent in chat",
      mimeType: "image/png",
      size: 256,
      description: "Here is the screenshot",
      usedIn: { threadId: null, messageId: expect.stringMatching(/^smsg_/) },
    });
    expect(item?.name).toMatch(/^image-\d{4}-\d{2}-\d{2}-\d{4}-1\.png$/);
  });

  test("expires into a marker: the file goes and the message's image answers 410", async () => {
    const { s, projectId } = await setup();
    setSystemTime(T0);
    const path = await sendImage(s, projectId);
    expect((await s.app.request(`/api${path}`)).status).toBe(200);

    setSystemTime(at(31));
    expect((await runLibraryRetention(s.ctx)).expired).toBe(1);

    const served = await s.app.request(`/api${path}`);
    expect(served.status).toBe(410);
    expect(await served.json()).toEqual({
      error: "This file expired and was removed from the Library",
      code: "IMAGE_REMOVED",
      reason: "expired",
      removedAt: at(31).toISOString(),
    });
    expect((await getListing(s, projectId)).items).toEqual([]);
  });

  test("deleted by the person, its message says so", async () => {
    const { s, projectId } = await setup();
    const path = await sendImage(s, projectId);
    const [item] = (await getListing(s, projectId)).items;

    await s.app.request(`/api/projects/${projectId}/library/items/${item?.id}`, {
      method: "DELETE",
    });

    const served = await s.app.request(`/api${path}`);
    expect(served.status).toBe(410);
    expect(((await served.json()) as { reason: string }).reason).toBe("deleted");
  });

  test("one the live index missed is indexed by the next cleanup, once", async () => {
    const { s, projectId } = await setup();
    await sendImage(s, projectId);
    await s.db.deleteFrom("library_items").execute();

    expect((await runLibraryRetention(s.ctx)).indexed).toBe(1);
    expect((await runLibraryRetention(s.ctx)).indexed).toBe(0);
    expect((await getListing(s, projectId)).items).toHaveLength(1);
  });
});

describe("caps", () => {
  test("a save over the project's cap evicts the least recently used automatic items, never the new one", async () => {
    const { s, projectId, coordinator } = await setup();
    await s.api("PUT", `/api/projects/${projectId}/library/settings`, {
      retentionDays: null,
      capMb: 1,
    });
    const kb = (size: number, value: string) => value.repeat(size * 1024);
    setSystemTime(T0);
    const oldest = await saveArtifact(s, coordinator, "oldest.txt", kb(400, "a"));
    setSystemTime(at(1));
    await saveArtifact(s, coordinator, "middle.txt", kb(400, "b"));
    setSystemTime(at(2));
    // Reading the oldest makes it the most recently used.
    await s.app.request(`/api/projects/${projectId}/library/items/${oldest.id}/content`);
    setSystemTime(at(3));
    await saveArtifact(s, coordinator, "newest.txt", kb(400, "c"));

    expect(await names(s, projectId)).toEqual(["newest.txt", "oldest.txt"]);
    expect((await getListing(s, projectId)).usage.bytes).toBe(800 * 1024);
  });

  test("the host's cap evicts across projects, least recently used first, and spares pinned items", async () => {
    const { s, projectId, coordinator } = await setup();
    const other = await createLibraryProject(s, "Other");
    await s.ctx.settingsRepository.set(SettingKey.LIBRARY_HOST_CAP_MB, "1");
    setSystemTime(T0);
    const pinned = await saveArtifact(s, coordinator, "pinned.bin", "p".repeat(500 * 1024));
    await s.services.library.update(projectId, pinned.id, { pinned: true });
    setSystemTime(at(1));
    await saveArtifact(s, other.coordinator, "old.bin", "o".repeat(300 * 1024));
    setSystemTime(at(2));
    await saveArtifact(s, coordinator, "new.bin", "n".repeat(300 * 1024));

    const report = await runLibraryRetention(s.ctx, at(3));

    expect(report.evicted).toBe(1);
    expect(await names(s, projectId)).toEqual(["new.bin", "pinned.bin"]);
    expect(await names(s, other.projectId)).toEqual([]);
  });
});

describe("orphans", () => {
  test("a blob no item uses goes once it is older than the grace period", async () => {
    const { s, projectId } = await setup();
    await uploadFile(s, projectId, "used.txt", "used");
    const stray = await putBlob(projectId, filler(10, 3));
    const strayPath = join(libraryDir(projectId), "blobs", stray.sha256);
    const leftover = join(libraryDir(projectId), "blobs", "abc.tmp");
    writeFileSync(leftover, "partial");

    expect((await runLibraryRetention(s.ctx)).orphans).toBe(0);

    const old = (Date.now() - ORPHAN_GRACE_MS - 1000) / 1000;
    utimesSync(strayPath, old, old);
    utimesSync(leftover, old, old);
    expect((await runLibraryRetention(s.ctx)).orphans).toBe(2);
    expect(blobCount(projectId)).toBe(1);
  });
});

describe("startLibraryRetention", () => {
  test("runs shortly after start, then once a day, never twice at once", async () => {
    jest.useFakeTimers();
    let calls = 0;
    let finish: () => void = () => {};
    const stop = startLibraryRetention(
      () => {
        calls++;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      { startupDelayMs: 1000, intervalMs: DAY },
    );

    jest.advanceTimersByTime(999);
    expect(calls).toBe(0);
    jest.advanceTimersByTime(1);
    expect(calls).toBe(1);
    // Still running a day later: the next run is skipped, not stacked.
    jest.advanceTimersByTime(DAY);
    expect(calls).toBe(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(DAY);
    expect(calls).toBe(2);

    stop();
    finish();
    jest.advanceTimersByTime(DAY * 3);
    expect(calls).toBe(2);
  });
});
