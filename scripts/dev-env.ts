#!/usr/bin/env bun
/**
 * Shared dev environment setup.
 *
 * Keeps the dev stack fully isolated from an installed release build: the dev
 * services and the dev CLI both point at a separate AOP_HOME so they never
 * share `~/.aop` (sqlite DB, logs, worktrees) with the released `aop`.
 *
 * Must not import workspace packages that read env at module load time - this
 * module runs before that env exists.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

export const DEV_AOP_HOME_DIR = ".aop-dev";

export const ROOT_DIR = resolve(import.meta.dirname, "..");

const ENV_FILE = resolve(ROOT_DIR, ".env");
const ENV_EXAMPLE_FILE = resolve(ROOT_DIR, ".env.example");

export const parseEnvFile = (content: string): Map<string, string> => {
  const vars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    vars.set(key, value);
  }
  return vars;
};

export const resolveDevAopHome = (homeDir: string = homedir()): string =>
  resolve(homeDir, DEV_AOP_HOME_DIR);

/**
 * Points AOP_HOME at the dev home unless the caller already chose one, so an
 * explicit `AOP_HOME=... bun dev` still wins.
 */
export const applyDevAopHome = (
  env: Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
): string => {
  const existing = env.AOP_HOME?.trim();
  if (existing) return existing;

  const devHome = resolveDevAopHome(homeDir);
  env.AOP_HOME = devHome;
  return devHome;
};

export const syncEnvFile = async (): Promise<void> => {
  const exampleFile = Bun.file(ENV_EXAMPLE_FILE);
  if (!(await exampleFile.exists())) {
    throw new Error(".env.example not found. Cannot configure environment.");
  }

  const exampleContent = await exampleFile.text();
  const exampleVars = parseEnvFile(exampleContent);

  const envFile = Bun.file(ENV_FILE);
  if (!(await envFile.exists())) {
    await Bun.write(ENV_FILE, exampleContent);
    process.stdout.write("Created .env from .env.example\n");
    return;
  }

  const envContent = await envFile.text();
  const envVars = parseEnvFile(envContent);

  const missingVars: string[] = [];
  for (const [key, value] of exampleVars) {
    if (!envVars.has(key)) {
      missingVars.push(`${key}=${value}`);
    }
  }

  if (missingVars.length > 0) {
    const newContent = `${envContent.trimEnd()}\n\n# Added from .env.example\n${missingVars.join("\n")}\n`;
    await Bun.write(ENV_FILE, newContent);
    const addedKeys = missingVars.map((v) => v.split("=")[0]).join(", ");
    process.stdout.write(`Added missing env vars to .env: ${addedKeys}\n`);
  }
};

export const loadEnvFile = async (): Promise<void> => {
  const envFile = Bun.file(ENV_FILE);
  if (!(await envFile.exists())) return;

  const content = await envFile.text();
  const vars = parseEnvFile(content);
  for (const [key, value] of vars) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

/** Syncs + loads `.env`, then pins the dev AOP_HOME. Returns the dev home. */
export const prepareDevEnv = async (): Promise<string> => {
  await syncEnvFile();
  await loadEnvFile();
  return applyDevAopHome();
};
