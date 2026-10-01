import type { Project, Thread } from "@aop/common";
import { generateTypeId, getLogger } from "@aop/infra";
import { serializeMessageOrigin } from "../chat-session/message-origin.ts";
import { nextChatTurnIndex } from "../chat-session/turn-order.ts";
import type { LocalServerContext } from "../context.ts";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import type { ThreadService } from "../thread/service.ts";
import { recordMessageCreated } from "./events.ts";
import { createKickoffRepository } from "./kickoff-repository.ts";
import { kickoffWelcome, surveyBrief, surveyReportAsk, surveyTitle } from "./kickoff-text.ts";
import { createProjectRepository } from "./repository.ts";
import { toWireMessage } from "./wire-messages.ts";

const logger = getLogger("project", "kickoff");

/**
 * A new project's first open, when the person leaves "Let the coordinator look around first" on:
 * the coordinator welcomes them, one read-only thread looks at what the project does and what is
 * in flight, and its report makes the coordinator write a summary and propose threads (see
 * thread/turn-outcome.ts). A project with no repository gets the welcome only. The survey starts
 * once: the thread is stored in the transaction that claims the pending kickoff, so a second
 * start, from a restart or a race, finds nothing to do.
 */
export interface ProjectKickoff {
  /** Starts the survey of a project whose kickoff is pending; nothing when there is none. */
  start: (projectId: string) => Promise<void>;
  /** Starts the surveys a restart left pending, one after the other. */
  resumePending: () => Promise<void>;
}

/**
 * In the transaction that creates the project: a project with a repository gets a pending
 * kickoff, whose welcome is posted with its survey; one without gets the welcome now. True
 * when a survey waits to be started.
 */
export const recordKickoff = async (
  tx: PublisherTransaction,
  project: Project,
): Promise<boolean> => {
  if (project.repoIds.length === 0) {
    await postWelcome(tx, project, null);
    return false;
  }
  await createKickoffRepository(tx.db).insertPending(project.id);
  return true;
};

/**
 * In the transaction that posts a finished report: when the thread is a new project's survey
 * reporting for the first time, what the coordinator is asked to do with the report (a summary
 * and proposals). The ask is recorded, so it is made once. Null for any other report.
 */
export const takeSurveyAsk = async (
  tx: PublisherTransaction,
  thread: Pick<Thread, "id" | "title" | "projectId">,
): Promise<string | null> => {
  if (!(await createKickoffRepository(tx.db).markReported(thread.id))) return null;
  const project = await createProjectRepository(tx.db).getById(thread.projectId);
  return surveyReportAsk(thread, project?.goal ?? "");
};

export const createProjectKickoff = (
  ctx: LocalServerContext,
  threads: ThreadService,
): ProjectKickoff => {
  const start = async (projectId: string): Promise<void> => {
    const project = await ctx.projectRepository.getById(projectId);
    if (!project) return;
    const spawned = await threads.spawn(projectId, {
      title: surveyTitle(project.name),
      prompt: surveyBrief(project.name),
      repoId: project.repoIds[0] ?? null,
      readOnly: true,
      inTransaction: async (tx, threadId) => {
        // Throwing keeps the thread from being stored: another start already made the survey.
        if (!(await createKickoffRepository(tx.db).claimSurvey(projectId, threadId))) {
          throw new SurveyAlreadyStarted();
        }
        await postWelcome(tx, project, threadId);
      },
    });
    if (!spawned.success) {
      logger.warn("Could not start the survey of project {projectId}: {code}", {
        projectId,
        code: spawned.error.code,
      });
    }
  };

  return {
    start: (projectId) => start(projectId).catch((error) => reportFailure(projectId, error)),

    resumePending: async () => {
      for (const projectId of await createKickoffRepository(ctx.db).listPending()) {
        await start(projectId).catch((error) => reportFailure(projectId, error));
      }
    },
  };
};

class SurveyAlreadyStarted extends Error {
  constructor() {
    super("The survey of this project was already started");
  }
}

const reportFailure = (projectId: string, error: unknown): void => {
  if (error instanceof SurveyAlreadyStarted) return;
  logger.error("The kickoff of project {projectId} failed: {error}", {
    projectId,
    error: String(error),
  });
};

// The welcome is the host's, written in the coordinator's name: the coordinator's own session
// has not run yet, and a model is not needed to say hello.
const postWelcome = async (
  tx: PublisherTransaction,
  project: Project,
  surveyThreadId: string | null,
): Promise<void> => {
  const coordinator = await tx.db
    .selectFrom("chat_sessions")
    .select("id")
    .where("project_id", "=", project.id)
    .where("kind", "=", "coordinator")
    .executeTakeFirstOrThrow();
  const row = await tx.db
    .insertInto("chat_messages")
    .values({
      id: generateTypeId("smsg"),
      session_id: coordinator.id,
      role: "assistant",
      content: kickoffWelcome(project.name, surveyThreadId !== null),
      turn_index: await nextChatTurnIndex(tx.db, coordinator.id),
      disposition: "immediate",
      created_at: new Date().toISOString(),
      origin_json: serializeMessageOrigin({ type: "kickoff-welcome", surveyThreadId }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const message = toWireMessage({ projectId: project.id, threadId: null }, row);
  if (message) await recordMessageCreated(tx, message);
};
