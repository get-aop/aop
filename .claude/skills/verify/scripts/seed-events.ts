#!/usr/bin/env bun
/**
 * Appends project events to a started verify stack through the same publisher the server
 * uses, so the project event stream (`GET /api/projects/:id/stream`) has something to
 * carry. The script opens the run's SQLite file directly: the running server does not hear
 * of the write, and delivers it on its next heartbeat read of the log (5 seconds).
 * Live reply text is not seedable this way, because it never touches the database.
 *
 *   bun .claude/skills/verify/scripts/seed-events.ts [--name <run>] <command> ...
 *
 *   project <projectId>                       creates the project, appends project.upserted
 *   thread <projectId> <threadId> [title]     creates a working thread, appends thread.upserted
 *   status <threadId> <status>                changes a thread's status, appends thread.upserted
 *   message <projectId> <id> <text> [threadId]  appends an assistant message.created; with
 *                                             --blocks '<json array>' the blocks replace the text
 *                                             (the entry validates on the client, so use real block shapes)
 *   remove <projectId>                        deletes the project, appends project.removed
 *
 * Prints the appended entry as JSON.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDatabase } from "../../../../apps/local-server/src/db/connection.ts";
import {
  createEventPublisher,
  type PublisherTransaction,
} from "../../../../apps/local-server/src/event-log/publisher.ts";
import { createProjectRepository } from "../../../../apps/local-server/src/project/repository.ts";
import {
  insertProjectSession,
  projectSettings,
} from "../../../../apps/local-server/src/project/test-utils.ts";
import {
  createThreadRepository,
  type ThreadStatusChange,
} from "../../../../apps/local-server/src/thread/repository.ts";
import { THREAD_STATUSES, type ThreadStatus } from "../../../../packages/common/src/index.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const args = process.argv.slice(2);
const flagValue = (flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};
const runName = flagValue("--name") ?? "default";
const blocksJson = flagValue("--blocks");
const positional = args.filter(
  (arg, i) =>
    !["--name", "--blocks"].includes(arg) && !["--name", "--blocks"].includes(args[i - 1] ?? ""),
);
const [command, ...rest] = positional;

const state = JSON.parse(
  await readFile(join(ROOT, ".work", "verify", runName, "state.json"), "utf8"),
) as { env: Record<string, string> };
const db = createDatabase(state.env.AOP_DB_PATH as string);
const publisher = createEventPublisher(db);

try {
  const entry = await run(command, rest);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
} finally {
  await db.destroy();
}

async function run(name: string | undefined, [a, b, c, d]: string[]) {
  switch (name) {
    case "project":
      return createProject(need(a, "projectId"));
    case "thread":
      return createThread(need(a, "projectId"), need(b, "threadId"), c ?? "A thread");
    case "status":
      return setStatus(need(a, "threadId"), threadStatus(need(b, "status")));
    case "message":
      return postMessage(need(a, "projectId"), need(b, "id"), need(c, "text"), d ?? null);
    case "remove":
      return removeProject(need(a, "projectId"));
    default:
      throw new Error(`Unknown command "${name}". See the header of this script.`);
  }
}

function createProject(projectId: string) {
  return publisher.transaction(async ({ db: trx, append }) => {
    const project = await createProjectRepository(trx).create({
      id: projectId,
      ...projectSettings({ name: projectId }),
    });
    return append({ projectId, type: "project.upserted", payload: { project } });
  });
}

function createThread(projectId: string, threadId: string, title: string) {
  return publisher.transaction(async (tx) => {
    await insertProjectSession(tx.db, { id: threadId, projectId, kind: "thread" }, { title });
    return appendThread(tx, threadId);
  });
}

function setStatus(threadId: string, status: ThreadStatus) {
  return publisher.transaction(async (tx) => {
    await createThreadRepository(tx.db).update(threadId, { status: statusChange(status) });
    return appendThread(tx, threadId);
  });
}

// The fields each status requires: a question to wait on, a time it was resolved.
function statusChange(status: ThreadStatus): ThreadStatusChange {
  if (status === "waiting-on-you") {
    return { status, blockedQuestion: { question: "Which one?", options: [] } };
  }
  if (status === "resolved") return { status, resolvedAt: new Date().toISOString() };
  if (status === "landing") throw new Error("A landing thread needs a pull request; not seedable.");
  return { status };
}

async function appendThread({ db: trx, append }: PublisherTransaction, threadId: string) {
  const thread = await createThreadRepository(trx).getById(threadId);
  if (!thread) throw new Error(`No thread ${threadId}`);
  return append({ projectId: thread.projectId, type: "thread.upserted", payload: { thread } });
}

function postMessage(projectId: string, id: string, text: string, threadId: string | null) {
  return publisher.publish({
    projectId,
    type: "message.created",
    payload: {
      message: {
        id,
        projectId,
        threadId,
        createdAt: new Date().toISOString(),
        role: "assistant",
        blocks: blocksJson ? JSON.parse(blocksJson) : [{ type: "text", text }],
      },
    },
  });
}

function removeProject(projectId: string) {
  return publisher.transaction(async ({ db: trx, append }) => {
    await createProjectRepository(trx).remove(projectId);
    return append({ projectId, type: "project.removed", payload: {} });
  });
}

function need(value: string | undefined, label: string): string {
  if (value === undefined) throw new Error(`Missing <${label}>. See the header of this script.`);
  return value;
}

function threadStatus(value: string): ThreadStatus {
  const status = THREAD_STATUSES.find((known) => known === value);
  if (!status) throw new Error(`Unknown status "${value}". One of: ${THREAD_STATUSES.join(", ")}`);
  return status;
}
