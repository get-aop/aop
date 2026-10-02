import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIBRARY_LIMITS } from "@aop/common";
import { readAgentFile } from "./agent-file.ts";

// An agent may save only files inside its own workspace, however it spells the path.

let root = "";
let workspace = "";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "aop-agent-file-")));
  workspace = join(root, "worktree");
  mkdirSync(join(workspace, "docs"), { recursive: true });
  mkdirSync(join(workspace, ".git"), { recursive: true });
  writeFileSync(join(workspace, "docs", "report.md"), "# Report");
  writeFileSync(join(workspace, ".git", "config"), "[core]");
  writeFileSync(join(root, "secret.txt"), "outside");
  symlinkSync(join(root, "secret.txt"), join(workspace, "link-out.txt"));
  symlinkSync(join(workspace, "docs", "report.md"), join(workspace, "link-in.md"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const codeOf = async (path: string, from: string | null = workspace) => {
  const result = await readAgentFile(from, path);
  return result.success ? "ok" : result.error.code;
};

describe("readAgentFile", () => {
  test("reads a file inside the workspace, by a relative or an absolute path", async () => {
    const relative = await readAgentFile(workspace, "docs/report.md");
    const absolute = await readAgentFile(workspace, join(workspace, "docs", "report.md"));

    expect(relative.success && new TextDecoder().decode(relative.bytes)).toBe("# Report");
    expect(absolute.success).toBe(true);
    expect(await codeOf("link-in.md")).toBe("ok");
  });

  test("refuses every way out of the workspace", async () => {
    expect(await codeOf("../secret.txt")).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await codeOf(join(root, "secret.txt"))).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await codeOf("link-out.txt")).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await codeOf("/etc/hosts")).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  test("refuses git's own folder, a folder, a missing file and no workspace", async () => {
    expect(await codeOf(".git/config")).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await codeOf("docs")).toBe("NOT_A_FILE");
    expect(await codeOf(".")).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(await codeOf("missing.md")).toBe("PATH_NOT_FOUND");
    expect(await codeOf("docs/report.md", null)).toBe("NO_WORKSPACE");
    expect(await codeOf("docs/report.md", join(root, "gone"))).toBe("NO_WORKSPACE");
  });

  test("refuses a file over the limit before reading it", async () => {
    const big = join(workspace, "big.bin");
    writeFileSync(big, "");
    await truncate(big, LIBRARY_LIMITS.artifactMaxBytes + 1);

    expect(await readAgentFile(workspace, "big.bin")).toEqual({
      success: false,
      error: { code: "FILE_TOO_LARGE", maxBytes: LIBRARY_LIMITS.artifactMaxBytes },
    });
  });
});
