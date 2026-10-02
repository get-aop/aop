import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type LinearScope, LinearScopeSchema } from "@aop/common";
import { aopPaths } from "@aop/infra";
import { z } from "zod";

/**
 * A project's Linear connection, stored on the host only: one file per project under
 * `$AOP_HOME/connections/linear/`, readable by its owner only (0600, in a 0700 directory). It is
 * kept out of the database, which backups and support bundles copy, and out of the project's own
 * directory, which its coordinator and repo-less threads work in.
 */
export interface StoredLinearConnection {
  apiKey: string;
  scope: LinearScope;
  workspace: string;
  viewer: string;
}

export interface LinearConnectionStore {
  read: (projectId: string) => Promise<StoredLinearConnection | null>;
  write: (projectId: string, connection: StoredLinearConnection) => Promise<void>;
  remove: (projectId: string) => Promise<void>;
}

const StoredSchema = z.object({
  apiKey: z.string().min(1),
  scope: LinearScopeSchema,
  workspace: z.string(),
  viewer: z.string(),
});

export const linearConnectionsDir = (): string => join(aopPaths.home(), "connections", "linear");

export const createLinearConnectionStore = (
  dir: () => string = linearConnectionsDir,
): LinearConnectionStore => {
  const fileOf = (projectId: string) => join(dir(), `${safeName(projectId)}.json`);
  return {
    read: async (projectId) => {
      let text: string;
      try {
        text = await readFile(fileOf(projectId), "utf8");
      } catch {
        return null;
      }
      const parsed = StoredSchema.safeParse(parseJson(text));
      return parsed.success ? parsed.data : null;
    },
    write: async (projectId, connection) => {
      await mkdir(dir(), { recursive: true, mode: 0o700 });
      await chmod(dir(), 0o700);
      const file = fileOf(projectId);
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(connection), { mode: 0o600 });
      await rename(temporary, file);
    },
    remove: async (projectId) => {
      await rm(fileOf(projectId), { force: true });
    },
  };
};

// Project ids are the host's own, but a path must never be built from anything that could climb.
const safeName = (projectId: string): string => projectId.replace(/[^A-Za-z0-9_-]/g, "_");

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
