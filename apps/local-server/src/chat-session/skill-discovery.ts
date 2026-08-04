import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Discover Claude Code skills from the repo and user skill directories.
 * Other runtimes return an empty list in v1 (menu entry is hidden client-side).
 */
export const discoverRuntimeSkills = async (
  runtime: string,
  repoPath: string,
): Promise<string[]> => {
  if (runtime !== "claude-code") return [];
  return discoverClaudeCodeSkills(repoPath);
};

export const discoverClaudeCodeSkills = async (
  repoPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string[]> => {
  const configuredDir = environment.CLAUDE_CONFIG_DIR?.trim();
  const userConfigDir = configuredDir
    ? resolve(repoPath, configuredDir)
    : join(homedir(), ".claude");
  const roots = [join(userConfigDir, "skills"), join(repoPath, ".claude", "skills")];
  const names = new Set<string>();
  for (const root of roots) {
    for (const name of await listSkillNames(root)) {
      names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
};

const listSkillNames = async (root: string): Promise<string[]> => {
  let entries: Array<{ name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillPath = join(root, entry.name, "SKILL.md");
    if (!(await fileExists(skillPath))) continue;
    const displayName = (await readSkillName(skillPath)) ?? entry.name;
    names.push(displayName);
  }
  return names;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
};

const readSkillName = async (skillPath: string): Promise<string | null> => {
  try {
    const content = await readFile(skillPath, "utf8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;
    const nameLine = match[1]?.match(/^name:\s*(.+)$/m);
    if (!nameLine?.[1]) return null;
    return nameLine[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
};
