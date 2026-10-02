import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { LIBRARY_LIMITS } from "@aop/common";

export type AgentFileError =
  | { code: "NO_WORKSPACE" }
  | { code: "PATH_NOT_FOUND"; path: string }
  | { code: "PATH_OUTSIDE_WORKSPACE"; path: string }
  | { code: "NOT_A_FILE"; path: string }
  | { code: "FILE_TOO_LARGE"; maxBytes: number };

/**
 * The bytes of a file an agent asks to save, read only from inside its own workspace (a
 * thread's worktree, the coordinator's folder). The path is resolved with every link followed
 * and checked again, so `../`, an absolute path elsewhere or a symlink out of the workspace
 * all fail the same way; git's own folder is refused too. The size is checked before reading.
 */
export const readAgentFile = async (
  workspacePath: string | null,
  requested: string,
): Promise<{ success: true; bytes: Uint8Array } | { success: false; error: AgentFileError }> => {
  if (!workspacePath) return { success: false, error: { code: "NO_WORKSPACE" } };
  const root = await realpath(workspacePath).catch(() => null);
  if (!root) return { success: false, error: { code: "NO_WORKSPACE" } };
  // Checked as written first, so a path outside is refused without saying whether it exists.
  const written = resolve(workspacePath, requested);
  if (!isInside(resolve(workspacePath), written) && !isInside(root, written)) {
    return { success: false, error: { code: "PATH_OUTSIDE_WORKSPACE", path: requested } };
  }
  const target = await realpath(written).catch(() => null);
  if (!target) return { success: false, error: { code: "PATH_NOT_FOUND", path: requested } };
  if (!isInside(root, target)) {
    return { success: false, error: { code: "PATH_OUTSIDE_WORKSPACE", path: requested } };
  }
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) return { success: false, error: { code: "NOT_A_FILE", path: requested } };
  if (info.size > LIBRARY_LIMITS.artifactMaxBytes) {
    return {
      success: false,
      error: { code: "FILE_TOO_LARGE", maxBytes: LIBRARY_LIMITS.artifactMaxBytes },
    };
  }
  return { success: true, bytes: new Uint8Array(await Bun.file(target).arrayBuffer()) };
};

const isInside = (root: string, target: string): boolean => {
  const path = relative(root, target);
  if (path === "" || path.startsWith("..") || isAbsolute(path)) return false;
  return !path.split(sep).includes(".git");
};
