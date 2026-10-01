import { type ReasoningEffort, ReasoningEffortSchema, type ReportedRuntime } from "@aop/common";
import { readRunInitEvent } from "../chat-session/init-event.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import { recordProjectUpserted } from "./events.ts";
import { createProjectRepository } from "./repository.ts";

// Claude Code writes assistant messages with this model for its own errors.
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * After a run of a role on "Use default", stores what the run's log says it ran on, so the
 * settings can say "Default (Opus 5.5)" and the chips "Opus 5.5". Only what the launch left to
 * the CLI is read: a run given `--model` says nothing about the default model, and one given
 * `--effort` nothing about the default effort. A report that changes nothing writes nothing, so
 * the project stream hears of it once, not after every turn.
 */
export const recordReportedRuntime = async (
  tx: PublisherTransaction,
  session: ChatSession,
  run: Pick<ChatRun, "log_file_path">,
): Promise<void> => {
  const projectId = session.project_id;
  if (!projectId || (session.model !== null && session.reasoning_effort !== null)) return;
  const reported = leftToTheCli(session, await readInitEvent(run.log_file_path));
  const role = session.kind === "thread" ? "thread" : "coordinator";
  const projects = createProjectRepository(tx.db);
  const current = (await projects.getById(projectId))?.reportedRuntime[role];
  if (!current || !changes(current, reported)) return;
  const project = await projects.recordReportedRuntime(projectId, role, reported);
  if (project) await recordProjectUpserted(tx, project);
};

const leftToTheCli = (
  session: ChatSession,
  init: { model: string | null; effort: ReasoningEffort | null },
): Partial<ReportedRuntime> => ({
  ...(session.model === null && init.model !== null && { model: init.model }),
  ...(session.reasoning_effort === null && init.effort !== null && { effort: init.effort }),
});

const changes = (current: ReportedRuntime, reported: Partial<ReportedRuntime>): boolean =>
  (reported.model !== undefined && reported.model !== current.model) ||
  (reported.effort !== undefined && reported.effort !== current.effort);

/**
 * The model (and effort, when it is there) from the `system` init event of a Claude Code
 * `stream-json` log, the only dialect a project runs. Claude Code 2.1.285 names the model and no
 * effort. A log that is missing or has no init event reports nothing.
 */
export const readInitEvent = async (
  logPath: string,
): Promise<{ model: string | null; effort: ReasoningEffort | null }> => {
  const event = await readRunInitEvent(logPath);
  if (!event) return { model: null, effort: null };
  const model =
    typeof event.model === "string" && event.model !== "" && event.model !== SYNTHETIC_MODEL
      ? event.model
      : null;
  return { model, effort: ReasoningEffortSchema.safeParse(event.effort).data ?? null };
};
