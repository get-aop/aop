import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LIBRARY_LIMITS, type LibraryItem } from "@aop/common";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../project/test-utils.ts";
import { libraryDir } from "./store.ts";
import { createLibraryProject, filler, getListing, uploadFile, uploadRaw } from "./test-utils.ts";

// The Library over HTTP: uploads stored once per content, the item actions, the content route's
// safety headers, and the project's retention settings.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path(), { repos: 0 });
  stack = s;
  const { projectId } = await createLibraryProject(s);
  return { s, projectId };
};

const blobs = (projectId: string): string[] => {
  const dir = join(libraryDir(projectId), "blobs");
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe("uploading to the Library", () => {
  test("stores the file under Uploads, typed from its bytes, and lists it with the usage", async () => {
    const { s, projectId } = await setup();

    const item = await uploadFile(s, projectId, "notes.md", "# Plan\n\n- ship it\n");

    expect(item).toMatchObject({
      name: "notes.md",
      folder: "Uploads",
      source: "upload",
      mimeType: "text/markdown",
      size: 18,
      pinned: false,
      // What the person added is never removed by age.
      expiresAt: null,
      usedIn: null,
    });
    const listing = await getListing(s, projectId);
    expect(listing.items.map((entry) => entry.id)).toEqual([item.id]);
    expect(listing.usage).toEqual({
      bytes: 18,
      capBytes: 1024 * 1024 * 1024,
      hostBytes: 18,
      hostCapBytes: 5120 * 1024 * 1024,
    });
    expect(listing.retention).toEqual({ retentionDays: 30, capMb: 1024 });
    expect(listing.settings).toEqual({ retentionDays: null, capMb: null });
  });

  test("keeps one file per content: the same bytes under two names share it and count once", async () => {
    const { s, projectId } = await setup();

    const first = await uploadFile(s, projectId, "a.txt", "same bytes");
    const second = await uploadFile(s, projectId, "b.txt", "same bytes");
    const again = await uploadFile(s, projectId, "a.txt", "same bytes");

    expect(second.id).not.toBe(first.id);
    // The same file, name and folder again is the item already there.
    expect(again.id).toBe(first.id);
    expect(blobs(projectId)).toHaveLength(1);
    expect((await getListing(s, projectId)).usage.bytes).toBe(10);
  });

  test("refuses an empty file, one over the limit, a bad name and a bad folder", async () => {
    const { s, projectId } = await setup();

    expect(await uploadRaw(s, projectId, "empty.txt", new Uint8Array())).toEqual({
      status: 400,
      body: { error: "The file is empty", code: "EMPTY_FILE" },
    });
    const large = await uploadRaw(
      s,
      projectId,
      "big.bin",
      filler(LIBRARY_LIMITS.uploadMaxBytes + 1),
    );
    expect(large).toEqual({
      status: 413,
      body: { error: "Files must be 50 MB or smaller", code: "FILE_TOO_LARGE" },
    });
    expect((await uploadRaw(s, projectId, "../escape.txt", "x")).body.code).toBe("INVALID_NAME");
    expect((await uploadRaw(s, projectId, "ok.txt", "x", "a/b/c/d/e")).body.code).toBe(
      "INVALID_FOLDER",
    );
    expect((await uploadRaw(s, "proj_nope", "ok.txt", "x")).status).toBe(404);
    expect(blobs(projectId)).toEqual([]);
  });

  test("refuses a file that would not fit beside what retention may not remove", async () => {
    const { s, projectId } = await setup();
    await s.api("PUT", `/api/projects/${projectId}/library/settings`, {
      retentionDays: null,
      capMb: 1,
    });
    await uploadFile(s, projectId, "big.bin", filler(700 * 1024, 1));

    const refused = await uploadRaw(s, projectId, "more.bin", filler(400 * 1024, 2));

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("LIBRARY_FULL");
  });
});

describe("an item's actions", () => {
  test("rename, move, describe and pin it; a bad name is refused and changes nothing", async () => {
    const { s, projectId } = await setup();
    const item = await uploadFile(s, projectId, "draft.md", "# Draft");

    const changed = await s.api<{ item: LibraryItem }>(
      "PATCH",
      `/api/projects/${projectId}/library/items/${item.id}`,
      { name: "final.md", folder: " Reports / Q3 ", description: "The Q3 report", pinned: true },
    );
    const refused = await s.api("PATCH", `/api/projects/${projectId}/library/items/${item.id}`, {
      name: "a/b.md",
    });
    const unknownField = await s.api(
      "PATCH",
      `/api/projects/${projectId}/library/items/${item.id}`,
      { sha256: "x" },
    );

    expect(changed.status).toBe(200);
    expect(changed.body.item).toMatchObject({
      name: "final.md",
      folder: "Reports/Q3",
      description: "The Q3 report",
      pinned: true,
    });
    expect(refused.status).toBe(400);
    expect(unknownField.status).toBe(400);
    expect((await getListing(s, projectId)).items[0]?.name).toBe("final.md");
  });

  test("delete removes the file only when no other item shares it", async () => {
    const { s, projectId } = await setup();
    const first = await uploadFile(s, projectId, "a.txt", "shared");
    const second = await uploadFile(s, projectId, "b.txt", "shared");

    const removed = await s.app.request(`/api/projects/${projectId}/library/items/${first.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect(blobs(projectId)).toHaveLength(1);

    await s.app.request(`/api/projects/${projectId}/library/items/${second.id}`, {
      method: "DELETE",
    });
    expect(blobs(projectId)).toEqual([]);
    expect((await getListing(s, projectId)).items).toEqual([]);
    const again = await s.app.request(`/api/projects/${projectId}/library/items/${second.id}`, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });

  test("an item is reached only through its own project", async () => {
    const { s, projectId } = await setup();
    const { projectId: otherId } = await createLibraryProject(s, "Other");
    const item = await uploadFile(s, projectId, "secret.txt", "mine");

    const read = await s.app.request(`/api/projects/${otherId}/library/items/${item.id}/content`);
    const patched = await s.api("PATCH", `/api/projects/${otherId}/library/items/${item.id}`, {
      pinned: true,
    });

    expect(read.status).toBe(404);
    expect(patched.status).toBe(404);
  });
});

describe("serving a file", () => {
  test("sends raster images and PDFs as themselves, markup as inert text, and counts the read", async () => {
    const { s, projectId } = await setup();
    const page = await uploadFile(s, projectId, "page.html", "<script>alert(1)</script>");
    const pdf = await uploadFile(s, projectId, "doc.pdf", "%PDF-1.7\n%âãÏÓ\n");

    const html = await s.app.request(`/api/projects/${projectId}/library/items/${page.id}/content`);
    const download = await s.app.request(
      `/api/projects/${projectId}/library/items/${pdf.id}/content?download=1`,
    );

    expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html.headers.get("content-security-policy")).toContain("sandbox");
    expect(await html.text()).toBe("<script>alert(1)</script>");
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''doc.pdf",
    );
    const listed = await getListing(s, projectId);
    const read = listed.items.find((item) => item.id === page.id);
    expect(Date.parse(read?.lastAccessedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(page.lastAccessedAt),
    );
  });
});

describe("the project's retention settings", () => {
  test("override the host's defaults, and null goes back to them", async () => {
    const { s, projectId } = await setup();

    const set = await s.api<{ retention: unknown; settings: unknown }>(
      "PUT",
      `/api/projects/${projectId}/library/settings`,
      { retentionDays: 7, capMb: 0 },
    );
    expect(set.status).toBe(200);
    expect(set.body.retention).toEqual({ retentionDays: 7, capMb: 0 });
    expect((await getListing(s, projectId)).usage.capBytes).toBeNull();

    const reset = await s.api<{ retention: unknown }>(
      "PUT",
      `/api/projects/${projectId}/library/settings`,
      { retentionDays: null, capMb: null },
    );
    expect(reset.body.retention).toEqual({ retentionDays: 30, capMb: 1024 });

    const invalid = await s.api("PUT", `/api/projects/${projectId}/library/settings`, {
      retentionDays: -1,
      capMb: null,
    });
    expect(invalid.status).toBe(400);
  });
});
