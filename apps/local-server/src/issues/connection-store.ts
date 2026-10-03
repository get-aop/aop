import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { z } from "zod";

/**
 * A project's connection to an issue tracker (Linear, Jira), stored on the host only: one file
 * per project under `$AOP_HOME/connections/<kind>/`, readable by its owner only (0600, in a 0700
 * directory). It is kept out of the database, which backups and support bundles copy, and out of
 * the project's own directory, which its coordinator and repo-less threads work in.
 */
export interface ConnectionStore<T> {
  read: (projectId: string) => Promise<T | null>;
  write: (projectId: string, connection: T) => Promise<void>;
  remove: (projectId: string) => Promise<void>;
}

/** The trackers a project can connect; removing a project removes each one's file. */
export const CONNECTION_KINDS = ["linear", "jira"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const connectionsDir = (kind: ConnectionKind): string =>
  join(aopPaths.home(), "connections", kind);

export const createConnectionStore = <T>(
  schema: z.ZodType<T>,
  dir: () => string,
): ConnectionStore<T> => {
  const fileOf = (projectId: string) => join(dir(), `${safeName(projectId)}.json`);
  return {
    read: async (projectId) => {
      let text: string;
      try {
        text = await readFile(fileOf(projectId), "utf8");
      } catch {
        return null;
      }
      const parsed = schema.safeParse(parseJson(text));
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

/** Deletes every tracker connection of a project: its keys and tokens go with it. */
export const removeProjectConnections = async (
  projectId: string,
  dirOf: (kind: ConnectionKind) => string = connectionsDir,
): Promise<void> => {
  await Promise.all(
    CONNECTION_KINDS.map((kind) =>
      rm(join(dirOf(kind), `${safeName(projectId)}.json`), { force: true }),
    ),
  );
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
