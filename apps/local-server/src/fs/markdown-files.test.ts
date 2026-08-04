import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MARKDOWN_FILE_LIMITS } from "@aop/common";
import { readMarkdownFile, writeMarkdownFile } from "./markdown-files.ts";

const temporaryDirectories: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aop-markdown-"));
  temporaryDirectories.push(root);
  return root;
};

const createContext = (roots: string[]) =>
  ({ repoRepository: { getAll: async () => roots.map((root) => ({ path: root })) } }) as never;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("readMarkdownFile", () => {
  test("reads an existing markdown file under a registered repository", async () => {
    const root = await createRoot();
    const filePath = path.join(root, ".aop", "plans", "plan.md");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "# Plan\n");

    const result = await readMarkdownFile(createContext([root]), filePath);

    expect(result).toEqual({
      success: true,
      data: { path: filePath, content: "# Plan\n", exists: true },
    });
  });

  test("returns an empty missing-file result for a markdown path under a repository", async () => {
    const root = await createRoot();
    const filePath = path.join(root, ".aop", "plans", "missing.md");

    const result = await readMarkdownFile(createContext([root]), filePath);

    expect(result).toEqual({
      success: true,
      data: { path: filePath, content: "", exists: false },
    });
  });

  test("expands a home-relative path before validating the repository root", async () => {
    const root = await mkdtemp(path.join(os.homedir(), "aop-markdown-home-"));
    temporaryDirectories.push(root);
    const filePath = path.join(root, "README.md");
    await writeFile(filePath, "# Home\n");
    const homeRelativePath = `~/${path.relative(os.homedir(), filePath)}`;

    const result = await readMarkdownFile(createContext([root]), homeRelativePath);

    expect(result).toEqual({
      success: true,
      data: { path: filePath, content: "# Home\n", exists: true },
    });
  });

  test("accepts a case-insensitive markdown extension and rejects other extensions", async () => {
    const root = await createRoot();
    const upperCasePath = path.join(root, "README.MD");
    await writeFile(upperCasePath, "# Readme\n");

    expect((await readMarkdownFile(createContext([root]), upperCasePath)).success).toBe(true);
    const rejected = await readMarkdownFile(createContext([root]), path.join(root, "notes.mdx"));
    expect(rejected).toEqual({
      success: false,
      error: { code: "INVALID_PATH", message: "Only Markdown files are supported" },
    });
  });

  test("rejects relative, escaping, and sibling-prefix paths", async () => {
    const root = await createRoot();
    const sibling = `${root}-evil`;
    await mkdir(sibling);
    temporaryDirectories.push(sibling);

    for (const filePath of [
      "relative.md",
      path.join(root, "..", "outside.md"),
      path.join(sibling, "outside.md"),
    ]) {
      const result = await readMarkdownFile(createContext([root]), filePath);
      const expectedCode = filePath === "relative.md" ? "INVALID_PATH" : "FORBIDDEN";
      expect(result).toMatchObject({ success: false, error: { code: expectedCode } });
    }
  });

  test("accepts a canonical path when the repository was registered through a symlink", async () => {
    const root = await createRoot();
    const aliasParent = await createRoot();
    const registeredRoot = path.join(aliasParent, "repo");
    await symlink(root, registeredRoot);
    const filePath = path.join(await realpath(registeredRoot), "README.md");
    await writeFile(filePath, "# Canonical\n");

    const result = await readMarkdownFile(createContext([registeredRoot]), filePath);

    expect(result).toEqual({
      success: true,
      data: { path: filePath, content: "# Canonical\n", exists: true },
    });
  });

  test("rejects a symlink that resolves outside the registered repository", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const link = path.join(root, "linked");
    await symlink(outside, link);

    const result = await readMarkdownFile(createContext([root]), path.join(link, "escape.md"));

    expect(result).toEqual({
      success: false,
      error: { code: "FORBIDDEN", message: "Path is outside registered repositories" },
    });
  });

  test("rejects a path outside the root even when a symlink points back into it", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const link = path.join(outside, "linked-repo");
    const filePath = path.join(root, "inside.md");
    await writeFile(filePath, "# Inside\n");
    await symlink(root, link);

    const result = await readMarkdownFile(createContext([root]), path.join(link, "inside.md"));

    expect(result).toEqual({
      success: false,
      error: { code: "FORBIDDEN", message: "Path is outside registered repositories" },
    });
  });
});

describe("writeMarkdownFile", () => {
  test("creates missing parent directories and persists content", async () => {
    const root = await createRoot();
    const filePath = path.join(root, ".aop", "plans", "new-plan.md");

    const result = await writeMarkdownFile(createContext([root]), filePath, "# New plan\n");

    expect(result).toEqual({
      success: true,
      data: { path: filePath, content: "# New plan\n", exists: true },
    });
    expect(await Bun.file(filePath).text()).toBe("# New plan\n");
  });

  test("rejects content over the shared one-megabyte limit", async () => {
    const root = await createRoot();
    const content = "x".repeat(MARKDOWN_FILE_LIMITS.maxBytes + 1);

    const result = await writeMarkdownFile(
      createContext([root]),
      path.join(root, "large.md"),
      content,
    );

    expect(result).toEqual({
      success: false,
      error: { code: "TOO_LARGE", message: "Markdown file is too large" },
    });
  });

  test("validates the path before applying the content-size limit", async () => {
    const root = await createRoot();
    const content = "x".repeat(MARKDOWN_FILE_LIMITS.maxBytes + 1);

    const result = await writeMarkdownFile(
      createContext([root]),
      path.join(root, "not-a-text.txt"),
      content,
    );

    expect(result).toEqual({
      success: false,
      error: { code: "INVALID_PATH", message: "Only Markdown files are supported" },
    });
  });
});
