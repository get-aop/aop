import type { Project } from "@aop/common";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { useProjectActions } from "../use-project-actions";

export const ChatLoading = () => (
  <div
    data-testid="chat-loading"
    role="status"
    className="flex flex-1 items-center justify-center gap-2 text-body text-text-subtle"
  >
    <Spinner className="size-3.5" />
    Loading the conversation…
  </div>
);

/** The first fetch of the chat failed: nothing is shown until it works, so the person is told and can retry. */
export const ChatError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div
    data-testid="chat-error"
    role="alert"
    className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
  >
    <h2 className="text-title font-medium text-text">Could not load the conversation</h2>
    <p className="max-w-sm text-body text-text-subtle">{message}</p>
    <p className="text-meta text-text-subtle">It is trying again on its own.</p>
    <Button type="button" size="sm" variant="outline" data-testid="chat-retry" onClick={onRetry}>
      Try again now
    </Button>
  </div>
);

/** A chat that was loaded once and cannot be refreshed: what is shown may be behind the host. */
export const ChatRefreshNotice = ({ message }: { message: string }) => (
  <p
    data-testid="chat-refresh-error"
    role="status"
    className="mb-2 rounded-row border border-border bg-raised px-3 py-1.5 text-meta text-text-muted"
  >
    Could not refresh the conversation ({message}). It is trying again.
  </p>
);

const STARTERS = (project: Project): string[] => [
  "What is the state of this project?",
  "Start a thread to audit the test suite and report what is fragile.",
  ...(project.goal.trim()
    ? [`Break the goal into threads: ${project.goal.trim().slice(0, 300)}`]
    : []),
];

/** An empty conversation: what the coordinator is for, and messages to start with. */
export const ChatEmpty = ({
  project,
  canStart,
  onStart,
}: {
  project: Project;
  /** False while the project is paused or archived: nothing can be sent to the coordinator. */
  canStart: boolean;
  onStart: (text: string) => void;
}) => (
  <div
    data-testid="chat-empty"
    className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
  >
    <div className="flex max-w-md flex-col gap-1.5">
      <h2 className="text-title font-medium text-text">Talk to the coordinator</h2>
      <p className="text-body text-text-muted">
        Say what you want done. The coordinator answers what it can, starts a thread for each piece
        of work, and tells you when one needs your call.
      </p>
    </div>
    {canStart ? (
      <ul className="flex max-w-md flex-col gap-1.5">
        {STARTERS(project).map((text) => (
          <li key={text}>
            <button
              type="button"
              data-testid="chat-starter"
              onClick={() => onStart(text)}
              className="line-clamp-2 w-full rounded-row border border-border bg-raised px-3 py-2 text-left text-body text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    ) : null}
  </div>
);

/** Why a paused or archived project cannot be talked to, with the way back. */
export const ProjectClosedNotice = ({ project }: { project: Project }) => {
  const actions = useProjectActions();
  const paused = project.status === "paused";
  return (
    <div
      data-testid="chat-closed-notice"
      data-status={project.status}
      className="mb-2 flex items-center gap-3 rounded-row border border-border bg-raised px-3 py-2 text-meta text-text-muted"
    >
      <p className="flex-1">
        {paused
          ? "This project is paused: the coordinator and its threads are stopped."
          : "This project is archived: it is read-only."}
      </p>
      <Button
        type="button"
        size="xs"
        variant="outline"
        data-testid="chat-closed-action"
        onClick={() => void actions.transition(project, paused ? "resume" : "restore")}
      >
        {paused ? "Resume project" : "Restore project"}
      </Button>
    </div>
  );
};

export const disabledReasonOf = (project: Project): string | null => {
  if (project.status === "paused") return "Paused. Resume the project to talk to the coordinator.";
  if (project.status === "archived")
    return "Archived. Restore the project to talk to the coordinator.";
  return null;
};
