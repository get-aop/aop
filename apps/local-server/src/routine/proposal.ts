import type { RoutineInput, RoutineSchedule } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { ChatEngine } from "../project/engine.ts";
import type { RoutineResult } from "./types.ts";

/** What a thread proposes: the routine it would make, and why, for the person. */
export interface RoutineProposal {
  routine: Omit<RoutineInput, "schedule"> & { schedule: RoutineSchedule };
  reason: string;
  /** The schedule in plain words. */
  when: string;
}

/**
 * Puts a thread's proposal in the coordinator's inbox. It is not shown in the chat: the
 * coordinator wakes on it and asks the person, whose answer decides whether it is created.
 */
export const sendRoutineProposal = async (
  ctx: LocalServerContext,
  chat: ChatEngine,
  projectId: string,
  thread: { id: string; title: string },
  proposal: RoutineProposal,
): Promise<RoutineResult<Record<never, never>>> => {
  const project = await ctx.projectRepository.getById(projectId);
  const coordinator = project && (await ctx.chatSessionRepository.getCoordinator(projectId));
  if (!project || !coordinator) return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
  if (project.status !== "active") {
    return { success: false, error: { code: "PROJECT_NOT_ACTIVE", status: project.status } };
  }
  const text = [
    `Thread "${thread.title}" (${thread.id}) proposes a routine. Ask the person before creating it with routine_create; nothing runs until you do.`,
    `Why: ${proposal.reason}`,
    `Proposal (${proposal.when}): ${JSON.stringify(proposal.routine)}`,
  ].join("\n\n");
  const sent = await chat.sendMessage(coordinator.id, {
    content: text,
    origin: { type: "routine-proposal", threadId: thread.id },
    midRunMode: "queue",
  });
  return sent.success
    ? { success: true }
    : {
        success: false,
        error: {
          code: "INVALID_ROUTINE",
          message: `The proposal could not be sent (${sent.error.code})`,
        },
      };
};
