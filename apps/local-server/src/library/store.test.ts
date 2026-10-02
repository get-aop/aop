import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  blobPath,
  libraryDir,
  listBlobs,
  putBlob,
  removeBlob,
  sha256Of,
  withLibraryLock,
} from "./store.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("the blob store", () => {
  test("names a file by its sha256 and keeps one copy per content", async () => {
    const projectId = `proj_store_${crypto.randomUUID()}`;

    const first = await putBlob(projectId, bytes("hello"));
    const second = await putBlob(projectId, bytes("hello"));
    const other = await putBlob(projectId, bytes("world"));

    expect(first).toEqual({
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      size: 5,
    });
    expect(second).toEqual(first);
    expect(other.sha256).toBe(sha256Of(bytes("world")));
    expect(readdirSync(join(libraryDir(projectId), "blobs")).sort()).toEqual(
      [first.sha256, other.sha256].sort(),
    );
    expect(await Bun.file(blobPath(projectId, first.sha256)).text()).toBe("hello");

    await removeBlob(projectId, first.sha256);
    expect(existsSync(blobPath(projectId, first.sha256))).toBe(false);
  });

  test("never makes a path from anything but a sha256", () => {
    expect(() => blobPath("proj_x", "../../etc/passwd")).toThrow("Not a sha256");
  });

  test("lists half-written leftovers apart from blobs", async () => {
    const projectId = `proj_store_${crypto.randomUUID()}`;
    const { sha256 } = await putBlob(projectId, bytes("kept"));
    writeFileSync(join(libraryDir(projectId), "blobs", `${sha256}.1.2.tmp`), "partial");

    const listed = await listBlobs(projectId);

    expect(listed.map((blob) => blob.sha256).sort()).toEqual([null, sha256].sort());
    expect(await listBlobs("proj_without_library")).toEqual([]);
  });
});

describe("withLibraryLock", () => {
  test("runs a project's work one at a time, and other projects' alongside", async () => {
    const order: string[] = [];
    const slow = withLibraryLock("proj_a", async () => {
      order.push("a1 start");
      await Bun.sleep(20);
      order.push("a1 end");
    });
    const queued = withLibraryLock("proj_a", async () => {
      order.push("a2");
    });
    const other = withLibraryLock("proj_b", async () => {
      order.push("b");
    });

    await Promise.all([slow, queued, other]);

    expect(order).toEqual(["a1 start", "b", "a1 end", "a2"]);
  });

  test("a failed piece of work does not block the next", async () => {
    const failed = withLibraryLock("proj_c", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");

    expect(await withLibraryLock("proj_c", async () => "next")).toBe("next");
  });
});
