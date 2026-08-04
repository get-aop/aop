import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { getCheckpointDiffFile, getCheckpointDiffSummary } from "./checkpoint-diff.ts";
import { captureWorkspaceCheckpoint } from "./checkpoints.ts";
import { applyPerFileCap, getSessionGitDiff, parseUnifiedDiff } from "./diff.ts";

const runGit = async (cwd: string, ...args: string[]): Promise<void> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
};

const createSession = async (
  ctx: ReturnType<typeof createCommandContext>,
  input: { id: string; repoId: string },
) => {
  const now = new Date().toISOString();
  return ctx.chatSessionRepository.create({
    id: input.id,
    repo_id: input.repoId,
    title: "Diff session",
    named: false,
    runtime: "claude-code",
    model: "claude-opus-4-8",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    runtime_configuration_id: null,
    fast_mode: false,
    pinned: false,
    settled_override: null,
    settled_at: null,
    default_worker_id: null,
    default_workflow_id: null,
    workspace_path: null,
    created_at: now,
    updated_at: now,
  });
};

describe("parseUnifiedDiff", () => {
  test("assigns old/new line numbers for context, add, and del rows", () => {
    const parsed = parseUnifiedDiff(`diff --git a/file.ts b/file.ts
index 111..222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2-changed
 line3
+line4
`);
    expect(parsed).toHaveLength(1);
    const file = parsed[0];
    expect(file?.path).toBe("file.ts");
    expect(file?.status).toBe("modified");
    const lines = file?.hunks[0]?.lines ?? [];
    expect(lines).toEqual([
      { type: "context", oldNo: 1, newNo: 1, text: "line1" },
      { type: "del", oldNo: 2, newNo: null, text: "line2" },
      { type: "add", oldNo: null, newNo: 2, text: "line2-changed" },
      { type: "context", oldNo: 3, newNo: 3, text: "line3" },
      { type: "add", oldNo: null, newNo: 4, text: "line4" },
    ]);
  });

  test("keeps hunk body lines that begin with -- or ++ as del/add rows", () => {
    const parsed = parseUnifiedDiff(`diff --git a/query.sql b/query.sql
index 111..222 100644
--- a/query.sql
+++ b/query.sql
@@ -1,3 +1,3 @@
 SELECT 1;
--- drop old comment
++ keep new comment
 SELECT 2;
`);
    expect(parsed).toHaveLength(1);
    const file = parsed[0];
    expect(file?.deletions).toBe(1);
    expect(file?.additions).toBe(1);
    const lines = file?.hunks[0]?.lines ?? [];
    // Raw unified-diff markers: first char is add/del; content may itself start with -/+.
    expect(lines).toEqual([
      { type: "context", oldNo: 1, newNo: 1, text: "SELECT 1;" },
      { type: "del", oldNo: 2, newNo: null, text: "-- drop old comment" },
      { type: "add", oldNo: null, newNo: 2, text: "+ keep new comment" },
      { type: "context", oldNo: 3, newNo: 3, text: "SELECT 2;" },
    ]);
  });

  test("tracks line numbers across multiple hunks", () => {
    const parsed = parseUnifiedDiff(`diff --git a/multi.ts b/multi.ts
index 111..222 100644
--- a/multi.ts
+++ b/multi.ts
@@ -1,2 +1,2 @@
 line1
-old-a
+new-a
@@ -10,2 +10,3 @@
 line10
 line11
+line12
`);
    expect(parsed).toHaveLength(1);
    const hunks = parsed[0]?.hunks ?? [];
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.lines).toEqual([
      { type: "context", oldNo: 1, newNo: 1, text: "line1" },
      { type: "del", oldNo: 2, newNo: null, text: "old-a" },
      { type: "add", oldNo: null, newNo: 2, text: "new-a" },
    ]);
    expect(hunks[1]?.lines).toEqual([
      { type: "context", oldNo: 10, newNo: 10, text: "line10" },
      { type: "context", oldNo: 11, newNo: 11, text: "line11" },
      { type: "add", oldNo: null, newNo: 12, text: "line12" },
    ]);
  });

  test("parses rename headers", () => {
    const parsed = parseUnifiedDiff(`diff --git a/old-name.ts b/new-name.ts
similarity index 90%
rename from old-name.ts
rename to new-name.ts
index 111..222 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1 +1 @@
-export const old = 1;
+export const neu = 1;
`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.status).toBe("renamed");
    expect(parsed[0]?.path).toBe("new-name.ts");
    expect(parsed[0]?.oldPath).toBe("old-name.ts");
  });

  test("marks binary files without hunk body rows", () => {
    const parsed = parseUnifiedDiff(`diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/logo.png differ
`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.status).toBe("binary");
    expect(parsed[0]?.path).toBe("logo.png");
    expect(parsed[0]?.hunks).toEqual([]);
  });

  test("decodes C-quoted non-ASCII paths from git output", () => {
    const parsed = parseUnifiedDiff(`diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"
index 111..222 100644
--- "a/caf\\303\\251.ts"
+++ "b/caf\\303\\251.ts"
@@ -1 +1 @@
-old
+new
`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.path).toBe("caf\u00e9.ts");
    expect(parsed[0]?.oldPath).toBe("caf\u00e9.ts");
  });

  test("decodes quoted rename headers", () => {
    const parsed = parseUnifiedDiff(`diff --git "a/old caf\\303\\251.ts" "b/new caf\\303\\251.ts"
similarity index 90%
rename from "old caf\\303\\251.ts"
rename to "new caf\\303\\251.ts"
`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.status).toBe("renamed");
    expect(parsed[0]?.path).toBe("new caf\u00e9.ts");
    expect(parsed[0]?.oldPath).toBe("old caf\u00e9.ts");
  });

  test("plain paths still parse alongside quoted ones", () => {
    const parsed = parseUnifiedDiff(`diff --git a/plain.ts b/plain.ts
index 111..222 100644
--- a/plain.ts
+++ b/plain.ts
@@ -1 +1 @@
-old
+new
diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"
index 333..444 100644
--- "a/caf\\303\\251.ts"
+++ "b/caf\\303\\251.ts"
@@ -1 +1 @@
-old
+new
`);
    expect(parsed.map((file) => file.path)).toEqual(["plain.ts", "caf\u00e9.ts"]);
  });
});

describe("applyPerFileCap", () => {
  test("trims context before it ever drops changed lines", () => {
    const lines = [
      ...Array.from({ length: 8 }, (_, index) => ({
        type: "context" as const,
        oldNo: index + 1,
        newNo: index + 1,
        text: `before ${index}`,
      })),
      { type: "del" as const, oldNo: 9, newNo: null, text: "old first" },
      { type: "add" as const, oldNo: null, newNo: 9, text: "new first" },
      ...Array.from({ length: 8 }, (_, index) => ({
        type: "context" as const,
        oldNo: index + 10,
        newNo: index + 10,
        text: `between ${index}`,
      })),
      { type: "del" as const, oldNo: 18, newNo: null, text: "old last" },
      { type: "add" as const, oldNo: null, newNo: 18, text: "new last" },
    ];
    const capped = applyPerFileCap(
      {
        path: "large.ts",
        oldPath: null,
        status: "modified",
        additions: 2,
        deletions: 2,
        truncated: false,
        hunks: [{ oldStart: 1, newStart: 1, lines }],
      },
      8,
    );
    const retained = capped.hunks.flatMap((hunk) => hunk.lines);
    expect(retained.filter((line) => line.type !== "context").map((line) => line.text)).toEqual([
      "old first",
      "new first",
      "old last",
      "new last",
    ]);
    expect(retained).toHaveLength(8);
    expect(capped.truncated).toBe(true);
  });

  test("allows changed rows above the nominal cap instead of losing changes", () => {
    const lines = Array.from({ length: 5 }, (_, index) => ({
      type: "add" as const,
      oldNo: null,
      newNo: index + 1,
      text: `added ${index}`,
    }));
    const capped = applyPerFileCap(
      {
        path: "all-new.ts",
        oldPath: null,
        status: "added",
        additions: 5,
        deletions: 0,
        truncated: false,
        hunks: [{ oldStart: 0, newStart: 1, lines }],
      },
      2,
    );
    expect(capped.hunks[0]?.lines).toEqual(lines);
    expect(capped.truncated).toBe(false);
  });
});

describe("getSessionGitDiff", () => {
  test("ignores user-configured external diff programs", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-diff-external-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_diff_external", repoPath);

    await writeFile(join(repoPath, "tracked.ts"), "export const value = 1;\n");
    await runGit(repoPath, "add", "tracked.ts");
    await runGit(repoPath, "commit", "-m", "base");
    await runGit(repoPath, "switch", "-c", "feature/external-diff");
    await runGit(repoPath, "config", "diff.external", "false");
    await writeFile(join(repoPath, "tracked.ts"), "export const value = 2;\n");

    const session = await createSession(ctx, {
      id: "csess_diff_external",
      repoId: "repo_diff_external",
    });
    const result = await getSessionGitDiff(ctx, session.id);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.diff.files.map((file) => file.path)).toContain("tracked.ts");
    }

    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("bounds unchanged context while keeping enough for the UI to fold", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-diff-context-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_diff_context", repoPath);

    const original = Array.from(
      { length: 400 },
      (_, index) => `export const line${index} = ${index};`,
    );
    await writeFile(join(repoPath, "context.ts"), `${original.join("\n")}\n`);
    await runGit(repoPath, "add", "context.ts");
    await runGit(repoPath, "commit", "-m", "base context");
    await runGit(repoPath, "switch", "-c", "feature/context");
    original[200] = "export const line200 = 2_000;";
    await writeFile(join(repoPath, "context.ts"), `${original.join("\n")}\n`);

    const session = await createSession(ctx, {
      id: "csess_diff_context01",
      repoId: "repo_diff_context",
    });
    const result = await getSessionGitDiff(ctx, session.id);

    expect(result.success).toBe(true);
    if (result.success) {
      const contextLines = result.diff.files[0]?.hunks.flatMap((hunk) => hunk.lines) ?? [];
      expect(contextLines.filter((line) => line.type === "context").length).toBeGreaterThan(20);
      expect(contextLines.filter((line) => line.type === "context").length).toBeLessThanOrEqual(40);
    }

    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("returns structured diffs for add/modify/delete and uncommitted changes", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-diff-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_diff_1", repoPath);

    await writeFile(join(repoPath, "keep.ts"), "export const keep = 1;\n");
    await writeFile(join(repoPath, "gone.ts"), "export const gone = 1;\n");
    await runGit(repoPath, "add", "keep.ts", "gone.ts");
    await runGit(repoPath, "commit", "-m", "base files");

    await runGit(repoPath, "switch", "-c", "feature/diff");
    await writeFile(join(repoPath, "keep.ts"), "export const keep = 2;\n");
    await rm(join(repoPath, "gone.ts"));
    await writeFile(join(repoPath, "new.ts"), "export const neu = 1;\n");
    await runGit(repoPath, "add", "-A");
    await runGit(repoPath, "commit", "-m", "feature changes");
    await writeFile(join(repoPath, "uncommitted.ts"), "export const dirty = 1;\n");

    const session = await createSession(ctx, {
      id: "csess_diff_structured01",
      repoId: "repo_diff_1",
    });

    const result = await getSessionGitDiff(ctx, session.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.diff.defaultBranch).toBe("main");
    const paths = result.diff.files.map((file) => file.path).sort();
    expect(paths).toEqual(["gone.ts", "keep.ts", "new.ts", "uncommitted.ts"].sort());
    expect(result.diff.files.find((file) => file.path === "new.ts")?.status).toBe("added");
    expect(result.diff.files.find((file) => file.path === "gone.ts")?.status).toBe("deleted");
    expect(result.diff.files.find((file) => file.path === "keep.ts")?.status).toBe("modified");
    expect(result.diff.files.find((file) => file.path === "uncommitted.ts")?.status).toBe("added");

    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("keeps non-ASCII filenames intact (git quotepath would otherwise empty them)", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-diff-utf8-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_diff_utf8", repoPath);

    await writeFile(join(repoPath, "base.ts"), "export const base = 1;\n");
    await runGit(repoPath, "add", "base.ts");
    await runGit(repoPath, "commit", "-m", "base");

    await runGit(repoPath, "switch", "-c", "feature/utf8");
    await writeFile(join(repoPath, "caf\u00e9.ts"), "export const coffee = 1;\n");
    await runGit(repoPath, "add", "-A");
    await runGit(repoPath, "commit", "-m", "add caf\u00e9");
    await writeFile(join(repoPath, "uncommitted-\u00fc.ts"), "export const dirty = 1;\n");

    const session = await createSession(ctx, {
      id: "csess_diff_utf8",
      repoId: "repo_diff_utf8",
    });

    const result = await getSessionGitDiff(ctx, session.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const paths = result.diff.files.map((file) => file.path).sort();
    expect(paths).toEqual(["caf\u00e9.ts", "uncommitted-\u00fc.ts"].sort());
    for (const file of result.diff.files) {
      expect(file.path.length).toBeGreaterThan(0);
    }

    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("covers rename and binary file statuses on a temp repo", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-session-diff-rb-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_diff_rb", repoPath);

    // Large-enough content so pure renames stay above git's similarity threshold.
    const renameBody = `${"export const value = 1;\n".repeat(20)}// end\n`;
    await writeFile(join(repoPath, "rename-me.ts"), renameBody);
    await runGit(repoPath, "add", "rename-me.ts");
    await runGit(repoPath, "commit", "-m", "base");

    await runGit(repoPath, "switch", "-c", "feature/rename-binary");
    await runGit(repoPath, "mv", "rename-me.ts", "renamed.ts");
    await writeFile(join(repoPath, "asset.bin"), new Uint8Array([9, 0, 8, 0, 7]));
    await runGit(repoPath, "add", "-A");
    await runGit(repoPath, "commit", "-m", "rename and binary");

    const session = await createSession(ctx, {
      id: "csess_diff_rename_bin01",
      repoId: "repo_diff_rb",
    });

    const result = await getSessionGitDiff(ctx, session.id);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const renamed = result.diff.files.find((file) => file.path === "renamed.ts");
    expect(renamed?.status).toBe("renamed");
    expect(renamed?.oldPath).toBe("rename-me.ts");

    const binary = result.diff.files.find((file) => file.path === "asset.bin");
    expect(binary?.status).toBe("binary");
    expect(binary?.hunks).toEqual([]);

    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("returns not found for an unknown session", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const result = await getSessionGitDiff(ctx, "csess_missing");
    expect(result).toEqual({ success: false, error: { code: "SESSION_NOT_FOUND" } });
    await db.destroy();
  });
});

describe("checkpoint diffs", () => {
  test("summarizes checkpoints and loads renamed and binary files", async () => {
    const db = await createTestDb();
    const repoPath = join(tmpdir(), `aop-checkpoint-diff-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_checkpoint_diff", repoPath);
    await runGit(repoPath, "config", "diff.external", "false");
    const beforeRef = "refs/aop/chat-checkpoints/csess_diff/crun_diff/before";
    const afterRef = "refs/aop/chat-checkpoints/csess_diff/crun_diff/after";

    const renameBody = `${"export const value = 1;\n".repeat(20)}// end\n`;
    await writeFile(join(repoPath, "rename-me.ts"), renameBody);
    await writeFile(join(repoPath, "delete-me.ts"), "delete\n");
    await runGit(repoPath, "add", ".");
    await runGit(repoPath, "commit", "-m", "checkpoint base");
    const before = await captureWorkspaceCheckpoint({ workspacePath: repoPath, ref: beforeRef });
    expect(before.success).toBe(true);

    await runGit(repoPath, "mv", "rename-me.ts", "renamed.ts");
    await writeFile(join(repoPath, "renamed.ts"), `${renameBody}export const added = 2;\n`);
    await rm(join(repoPath, "delete-me.ts"));
    await writeFile(join(repoPath, "added.ts"), "one\ntwo\n");
    await writeFile(join(repoPath, "asset.bin"), new Uint8Array([9, 0, 8, 0, 7]));
    const after = await captureWorkspaceCheckpoint({ workspacePath: repoPath, ref: afterRef });
    expect(after.success).toBe(true);

    const summary = await getCheckpointDiffSummary({
      workspacePath: repoPath,
      fromRef: beforeRef,
      toRef: afterRef,
    });
    expect(summary.success).toBe(true);
    if (!summary.success) return;
    expect(summary.value.summaryOnly).toBe(true);
    expect(summary.value.files.find((file) => file.path === "added.ts")).toMatchObject({
      status: "added",
      additions: 2,
      deletions: 0,
    });
    expect(summary.value.files.find((file) => file.path === "delete-me.ts")?.status).toBe(
      "deleted",
    );
    expect(summary.value.files.find((file) => file.path === "asset.bin")?.status).toBe("binary");
    expect(summary.value.files.find((file) => file.path === "renamed.ts")).toMatchObject({
      status: "renamed",
      oldPath: "rename-me.ts",
      additions: 1,
      deletions: 0,
    });

    const renamed = await getCheckpointDiffFile({
      workspacePath: repoPath,
      fromRef: beforeRef,
      toRef: afterRef,
      path: "rename-me.ts",
    });
    expect(renamed.success).toBe(true);
    if (renamed.success) {
      expect(renamed.value.file.path).toBe("renamed.ts");
      expect(renamed.value.file.oldPath).toBe("rename-me.ts");
      expect(renamed.value.file.hunks.flatMap((hunk) => hunk.lines)).toContainEqual({
        type: "add",
        oldNo: null,
        newNo: 22,
        text: "export const added = 2;",
      });
    }

    const binary = await getCheckpointDiffFile({
      workspacePath: repoPath,
      fromRef: beforeRef,
      toRef: afterRef,
      path: "asset.bin",
    });
    expect(binary.success).toBe(true);
    if (binary.success) expect(binary.value.file.hunks).toEqual([]);

    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("returns typed failures for invalid and unchanged paths", async () => {
    const db = await createTestDb();
    const repoPath = join(tmpdir(), `aop-checkpoint-diff-path-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_checkpoint_diff_path", repoPath);
    const beforeRef = "refs/aop/chat-checkpoints/csess_path/crun_path/before";
    const afterRef = "refs/aop/chat-checkpoints/csess_path/crun_path/after";
    await captureWorkspaceCheckpoint({ workspacePath: repoPath, ref: beforeRef });
    await captureWorkspaceCheckpoint({ workspacePath: repoPath, ref: afterRef });

    const invalid = await getCheckpointDiffFile({
      workspacePath: repoPath,
      fromRef: beforeRef,
      toRef: afterRef,
      path: "../secret",
    });
    const unchanged = await getCheckpointDiffFile({
      workspacePath: repoPath,
      fromRef: beforeRef,
      toRef: afterRef,
      path: "README.md",
    });
    expect(invalid).toMatchObject({ success: false, error: { code: "INVALID_PATH" } });
    expect(unchanged).toMatchObject({ success: false, error: { code: "INVALID_PATH" } });

    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });
});
