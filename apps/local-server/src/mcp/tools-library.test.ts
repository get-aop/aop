import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { truncate } from "node:fs/promises";
import { join, relative } from "node:path";
import { LIBRARY_LIMITS } from "@aop/common";
import { createLibraryProject, getListing, uploadFile } from "../library/test-utils.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../project/test-utils.ts";

// aop_library_save, _list and _read as an agent calls them: through the MCP endpoint, signed as
// its session. A thread saves from its own workspace only; the coordinator saves text it wrote.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path(), { repos: 0 });
  stack = s;
  const { projectId, coordinator } = await createLibraryProject(s);
  const spawned = await s.services.threads.spawn(projectId, { prompt: "write the report" });
  if (!spawned.success) throw new Error("thread not spawned");
  await s.settle();
  const thread = await s.ctx.chatSessionRepository.getById(spawned.thread.id);
  if (!thread?.workspace_path) throw new Error("thread has no workspace");
  return { s, projectId, coordinator, threadId: thread.id, workspace: thread.workspace_path };
};

const payload = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0]?.text ?? "null");

describe("aop_library_save", () => {
  test("a thread saves a file from its workspace, and the item links back to the thread", async () => {
    const { s, projectId, threadId, workspace } = await setup();
    mkdirSync(join(workspace, "out"), { recursive: true });
    writeFileSync(join(workspace, "out", "report.md"), "# Findings\n");

    const result = await s.callTool(threadId, "aop_library_save", {
      path: "out/report.md",
      folder: "Reports",
      description: "What the audit found",
    });

    expect(result.isError).toBeUndefined();
    expect(payload(result).saved).toMatchObject({
      name: "report.md",
      folder: "Reports",
      source: "artifact",
      mimeType: "text/markdown",
      size: 11,
    });
    const [item] = (await getListing(s, projectId)).items;
    expect(item?.usedIn).toEqual({ threadId, messageId: null });
  });

  test("the coordinator saves text it wrote; the default folder is Artifacts", async () => {
    const { s, projectId, coordinator } = await setup();

    const result = await s.callTool(coordinator.id, "aop_library_save", {
      content: "# Summary",
      name: "summary.md",
    });

    expect(payload(result).saved).toMatchObject({ name: "summary.md", folder: "Artifacts" });
    expect((await getListing(s, projectId)).items[0]?.usedIn).toEqual({
      threadId: null,
      messageId: null,
    });
  });

  test("refuses paths outside the workspace, links out of it and git's folder", async () => {
    const { s, threadId, workspace } = await setup();
    const outside = join(home.path(), "outside.txt");
    writeFileSync(outside, "not yours");
    symlinkSync(outside, join(workspace, "sneaky.txt"));
    mkdirSync(join(workspace, ".git"), { recursive: true });
    writeFileSync(join(workspace, ".git", "config"), "[core]");

    const climbing = relative(workspace, outside);
    for (const path of [
      climbing,
      "../../../../nowhere.txt",
      outside,
      "sneaky.txt",
      ".git/config",
    ]) {
      const result = await s.callTool(threadId, "aop_library_save", { path });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("is outside your workspace");
    }
    const missing = await s.callTool(threadId, "aop_library_save", { path: "nope.md" });
    expect(missing.content[0]?.text).toBe("No file at nope.md");
  });

  test("checks its arguments: one of path or content, a name for content, the size limits", async () => {
    const { s, threadId, workspace } = await setup();
    const big = join(workspace, "big.bin");
    writeFileSync(big, "");
    await truncate(big, LIBRARY_LIMITS.artifactMaxBytes + 1);

    const errors = await Promise.all(
      [
        {},
        { path: "a.md", content: "x" },
        { content: "x" },
        { content: "x", name: "../x.md" },
        { content: "x", name: "x.md", folder: "a/b/c/d/e" },
        { content: "", name: "empty.md" },
        { path: "big.bin" },
      ].map(
        async (args) => (await s.callTool(threadId, "aop_library_save", args)).content[0]?.text,
      ),
    );

    expect(errors).toEqual([
      "Give exactly one of `path` or `content`",
      "Give exactly one of `path` or `content`",
      "Give a `name` when you save `content`",
      "Use a file name of 1 to 200 characters, without / or \\",
      "Use a folder path of at most 4 levels of 80 characters",
      "The file is empty",
      "Files must be 25 MB or smaller",
    ]);
  });
});

describe("aop_library_list and aop_library_read", () => {
  test("an agent finds what the person uploaded and reads it as text", async () => {
    const { s, projectId, threadId } = await setup();
    const brief = await uploadFile(s, projectId, "brief.md", "# Brief\nShip it.", "Docs");
    await uploadFile(s, projectId, "other.txt", "elsewhere");

    const listed = payload(await s.callTool(threadId, "aop_library_list", { folder: "Docs" }));
    const read = payload(await s.callTool(threadId, "aop_library_read", { id: brief.id }));

    expect(listed.items.map((item: { name: string }) => item.name)).toEqual(["brief.md"]);
    expect(read).toMatchObject({ truncated: false, text: "# Brief\nShip it." });
  });

  test("reading a binary file or an unknown id is an error the model can act on", async () => {
    const { s, projectId, threadId } = await setup();
    const zip = await uploadFile(s, projectId, "a.zip", new Uint8Array([0x50, 0x4b, 0, 0]));

    const binary = await s.callTool(threadId, "aop_library_read", { id: zip.id });
    const unknown = await s.callTool(threadId, "aop_library_read", { id: "lib_nope" });

    expect(binary).toMatchObject({ isError: true });
    expect(binary.content[0]?.text).toContain("not text");
    expect(unknown.content[0]?.text).toBe("No such file in the Library");
  });
});
