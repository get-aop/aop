import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const SOURCE_METHODOLOGY_DIR = join(dirname(import.meta.path), "methodology");

export type MethodologySkillName = string;

const methodologyCache = new Map<string, string>();
let methodologySkillNamesCache: string[] | null = null;

export const listMethodologySkillNames = async (): Promise<MethodologySkillName[]> => {
  if (methodologySkillNamesCache) {
    return methodologySkillNamesCache;
  }

  const names = new Set<string>();
  for (const dir of getMethodologyDirs()) {
    for (const filename of await readMethodologyFilenames(dir)) {
      names.add(filename.slice(0, -".md".length));
    }
  }

  methodologySkillNamesCache = [...names].sort();
  return methodologySkillNamesCache;
};

export const isMethodologySkillName = async (value: string): Promise<boolean> =>
  (await listMethodologySkillNames()).includes(value);

export const loadMethodologySkill = async (name: string): Promise<string> => {
  const cached = methodologyCache.get(name);
  if (cached) {
    return cached;
  }

  const filePath = await resolveMethodologyFile(`${name}.md`);
  if (!filePath) {
    throw new Error(`Methodology skill not found: ${name}`);
  }

  const content = (await Bun.file(filePath).text()).trim();
  methodologyCache.set(name, content);
  return content;
};

export const clearMethodologyCache = (): void => {
  methodologyCache.clear();
  methodologySkillNamesCache = null;
};

export const resolveMethodologyPartial = async (partialName: string): Promise<string | null> => {
  if (!partialName.startsWith("methodology:")) {
    return null;
  }

  const skillName = partialName.slice("methodology:".length);
  if (!skillName) {
    throw new Error("Methodology partial name is empty");
  }

  return loadMethodologySkill(skillName);
};

const resolveMethodologyFile = async (filename: string): Promise<string | null> => {
  for (const dir of getMethodologyDirs()) {
    const filePath = join(dir, filename);
    if (await Bun.file(filePath).exists()) {
      return filePath;
    }
  }

  return null;
};

const readMethodologyFilenames = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }
};

const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "ENOENT";

const getMethodologyDirs = (): string[] => {
  const dirs = [
    process.env.AOP_METHODOLOGY_DIR,
    join(dirname(process.execPath), "methodology"),
    SOURCE_METHODOLOGY_DIR,
  ].filter((dir): dir is string => Boolean(dir));

  return [...new Set(dirs)];
};
