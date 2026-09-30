import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSessionGitDiffFile, getSessionGitDiffSummary } from "./diff.ts";
import { setupPrSession, teardownPrSession } from "./test-utils.ts";
import { UNTRACKED_COUNT_CAP_BYTES } from "./untracked-file.ts";

type Session = Awaited<ReturnType<typeof setupPrSession>>;
let session: Session | undefined;

afterEach(async () => {
  if (session) await teardownPrSession(session.db, session.repoPath);
  session = undefined;
});

/** A real repository on `main` whose working tree holds these files, none of them added to git. */
const withUntracked = async (files: Record<string, string | Uint8Array>): Promise<Session> => {
  session = await setupPrSession({ title: "Untracked counts" });
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(session.repoPath, path)), { recursive: true });
    await writeFile(join(session.repoPath, path), body);
  }
  return session;
};

const summarize = async ({ ctx, sessionId }: Session) => {
  const result = await getSessionGitDiffSummary(ctx, sessionId);
  if (!result.success) throw new Error(`no summary: ${JSON.stringify(result.error)}`);
  return new Map(result.diff.files.map((file) => [file.path, file]));
};

const open = async ({ ctx, sessionId }: Session, path: string) => {
  const result = await getSessionGitDiffFile(ctx, sessionId, path);
  if (!result.success) throw new Error(`${path} not opened: ${JSON.stringify(result.error)}`);
  return result.file;
};

describe("the summary of untracked files", () => {
  test("counts each text file's lines, the count its opened body has", async () => {
    const s = await withUntracked({
      "trailing.md": "one\ntwo\nthree\n",
      "no-trailing.md": "one\ntwo",
      "empty.md": "",
      "blank-lines.md": "\n\n",
      "nested/deep.ts": "export const deep = 1;\n",
    });
    const expected = {
      "trailing.md": 3,
      "no-trailing.md": 2,
      "empty.md": 0,
      "blank-lines.md": 2,
      "nested/deep.ts": 1,
    };

    const summary = await summarize(s);

    for (const [path, additions] of Object.entries(expected)) {
      expect(summary.get(path)).toEqual({
        path,
        oldPath: null,
        status: "added",
        additions,
        deletions: 0,
        truncated: false,
        hunks: [],
        detailsPending: true,
      });
      const body = await open(s, path);
      expect(body.additions).toBe(additions);
      expect(body.hunks.flatMap((hunk) => hunk.lines)).toHaveLength(additions);
    }
  });

  test("lists a binary file as binary with no lines, as its opened body is", async () => {
    const s = await withUntracked({ "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]) });

    const summary = await summarize(s);
    const body = await open(s, "logo.png");

    expect(summary.get("logo.png")).toMatchObject({
      status: "binary",
      additions: 0,
      deletions: 0,
      detailsPending: true,
    });
    expect(body).toMatchObject({ status: "binary", additions: 0, hunks: [] });
  });

  test("counts a file at the cap, and leaves a bigger text file to be counted when opened", async () => {
    const s = await withUntracked({
      "at-cap.txt": `${"y".repeat(UNTRACKED_COUNT_CAP_BYTES - 1)}\n`,
      "over-cap.txt": `${"x".repeat(UNTRACKED_COUNT_CAP_BYTES)}\n`,
      "over-cap.bin": new Uint8Array(UNTRACKED_COUNT_CAP_BYTES + 10),
    });

    const summary = await summarize(s);

    expect(summary.get("at-cap.txt")).toMatchObject({ status: "added", additions: 1 });
    expect(summary.get("over-cap.txt")).toMatchObject({
      status: "added",
      additions: 0,
      detailsPending: true,
    });
    // Whether a file is binary is decided by its first bytes, so a big one is still told.
    expect(summary.get("over-cap.bin")).toMatchObject({ status: "binary", additions: 0 });
    expect(await open(s, "over-cap.txt")).toMatchObject({ status: "added", additions: 1 });
  });

  test("lists a path it cannot read without a count, and still counts the others", async () => {
    const s = await withUntracked({ "fine.md": "fine\n", "folder/inside.md": "inside\n" });
    await symlink("nowhere.md", join(s.repoPath, "dangling.md"));
    await symlink("folder", join(s.repoPath, "folder-link"));

    const summary = await summarize(s);

    expect(summary.get("dangling.md")).toMatchObject({ status: "added", additions: 0 });
    expect(summary.get("folder-link")).toMatchObject({ status: "added", additions: 0 });
    expect(summary.get("fine.md")).toMatchObject({ status: "added", additions: 1 });
    expect(summary.get("folder/inside.md")).toMatchObject({ status: "added", additions: 1 });
  });

  test("gives each of many files its own count", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `many/file-${index}.txt`,
        "line\n".repeat(index + 1),
      ]),
    );
    const s = await withUntracked(files);

    const summary = await summarize(s);

    expect(summary.size).toBe(40);
    for (let index = 0; index < 40; index++) {
      expect(summary.get(`many/file-${index}.txt`)?.additions).toBe(index + 1);
    }
  });
});
