import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MARKDOWN_FILE_LIMITS, type MarkdownFileContent } from "@aop/common";
import type { LocalServerContext } from "../context.ts";

export type MarkdownFileError =
  | { code: "INVALID_PATH"; message: string }
  | { code: "FORBIDDEN"; message: string }
  | { code: "TOO_LARGE"; message: string };

export type MarkdownFileResult<T> =
  | { success: true; data: T }
  | { success: false; error: MarkdownFileError };

export const readMarkdownFile = async (
  ctx: LocalServerContext,
  rawPath: string,
): Promise<MarkdownFileResult<MarkdownFileContent>> => {
  const validated = await validatePath(ctx, rawPath);
  if (!validated.success) return validated;
  const file = Bun.file(validated.data);
  if (!(await file.exists())) {
    return { success: true, data: { path: validated.data, content: "", exists: false } };
  }
  return {
    success: true,
    data: { path: validated.data, content: await file.text(), exists: true },
  };
};

export const writeMarkdownFile = async (
  ctx: LocalServerContext,
  rawPath: string,
  content: string,
): Promise<MarkdownFileResult<MarkdownFileContent>> => {
  const validated = await validatePath(ctx, rawPath);
  if (!validated.success) return validated;
  if (new TextEncoder().encode(content).byteLength > MARKDOWN_FILE_LIMITS.maxBytes) {
    return { success: false, error: { code: "TOO_LARGE", message: "Markdown file is too large" } };
  }
  await Bun.write(validated.data, content);
  return { success: true, data: { path: validated.data, content, exists: true } };
};

const resolveInputPath = (rawPath: string): MarkdownFileResult<string> => {
  const expanded = rawPath.startsWith("~/") ? path.join(os.homedir(), rawPath.slice(2)) : rawPath;
  if (!path.isAbsolute(expanded)) {
    return { success: false, error: { code: "INVALID_PATH", message: "Path must be absolute" } };
  }
  const resolved = path.resolve(expanded);
  if (path.extname(resolved).toLowerCase() !== ".md") {
    return {
      success: false,
      error: { code: "INVALID_PATH", message: "Only Markdown files are supported" },
    };
  }
  return { success: true, data: resolved };
};

const isContained = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const nearestExistingPath = async (target: string): Promise<string> => {
  let candidate = target;
  while (candidate !== path.dirname(candidate)) {
    try {
      return await realpath(candidate);
    } catch {
      candidate = path.dirname(candidate);
    }
  }
  return realpath(candidate);
};

const validatePath = async (
  ctx: LocalServerContext,
  rawPath: string,
): Promise<MarkdownFileResult<string>> => {
  const parsed = resolveInputPath(rawPath);
  if (!parsed.success) return parsed;
  const target = parsed.data;
  const repos = await ctx.repoRepository.getAll();

  for (const repo of repos) {
    const configuredRoot = path.resolve(repo.path);
    let root: string;
    try {
      root = await realpath(repo.path);
    } catch {
      continue;
    }
    if (!isContained(configuredRoot, target) && !isContained(root, target)) continue;

    const resolvedTarget = await nearestExistingPath(target);
    if (isContained(root, resolvedTarget)) return { success: true as const, data: target };
  }

  return {
    success: false,
    error: { code: "FORBIDDEN", message: "Path is outside registered repositories" },
  };
};
