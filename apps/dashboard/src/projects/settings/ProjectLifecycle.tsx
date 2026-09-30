import type { Project } from "@aop/common";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { useProjectActions } from "../use-project-actions";
import { SettingsBlock } from "./blocks";

/** Starts the coordinator over with a fresh session; the chat and the threads stay. */
export const CoordinatorRestart = ({ project }: { project: Project }) => {
  const actions = useProjectActions();
  const restart = async () => {
    const confirmed = await requestConfirmation({
      title: "Restart the coordinator?",
      message:
        "It starts a new session and re-reads the instructions and memory. The chat stays, and no thread is touched or stopped.",
      confirmLabel: "Restart coordinator",
    });
    if (confirmed) await actions.restartCoordinator(project);
  };

  return (
    <SettingsBlock
      title="Coordinator"
      description="If the coordinator is stuck or has lost the thread, restart it. Threads keep running."
      testId="settings-coordinator"
    >
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="settings-restart-coordinator"
          disabled={project.status === "archived"}
          onClick={() => void restart()}
        >
          Restart coordinator
        </Button>
      </div>
    </SettingsBlock>
  );
};

/** Pause, archive and delete, each behind a question, since they stop work or end the project. */
export const DangerZone = ({ project }: { project: Project }) => {
  const actions = useProjectActions();
  const archived = project.status === "archived";
  const paused = project.status === "paused";

  const askThen = async (
    options: { title: string; message: string; confirmLabel: string },
    run: () => Promise<void>,
  ) => {
    if (await requestConfirmation(options)) await run();
  };

  return (
    <SettingsBlock title="Danger zone" tone="danger" testId="settings-danger-zone">
      <div className="flex flex-col divide-y divide-border rounded-row border border-border">
        {archived ? null : (
          <DangerRow
            title={paused ? "Resume project" : "Pause project"}
            description={
              paused
                ? "Lets the coordinator and threads run again."
                : "Stops the coordinator and every running thread, and refuses new messages until you resume."
            }
            testId="settings-pause"
            label={paused ? "Resume" : "Pause"}
            onClick={() =>
              paused
                ? void actions.transition(project, "resume")
                : void askThen(
                    {
                      title: `Pause “${project.name}”?`,
                      message:
                        "The coordinator and every running thread stop now. Nothing is deleted, and you can resume at any time.",
                      confirmLabel: "Pause project",
                    },
                    () => actions.transition(project, "pause"),
                  )
            }
          />
        )}
        <DangerRow
          title={archived ? "Restore project" : "Archive project"}
          description={
            archived
              ? "Brings the project back to the sidebar."
              : "Stops all work and moves the project out of the way. Threads and memory are kept."
          }
          testId="settings-archive"
          label={archived ? "Restore" : "Archive"}
          onClick={() =>
            archived
              ? void actions.transition(project, "restore")
              : void askThen(
                  {
                    title: `Archive “${project.name}”?`,
                    message:
                      "Every running thread stops and the project moves to Archived. Threads and memory are kept, and you can restore it.",
                    confirmLabel: "Archive project",
                  },
                  () => actions.transition(project, "archive"),
                )
          }
        />
        <DangerRow
          title="Delete project"
          description="Deletes its threads, chat and memory for good. Repositories stay attached to AOP."
          testId="settings-delete"
          label="Delete project"
          destructive
          onClick={() => void actions.remove(project)}
        />
      </div>
    </SettingsBlock>
  );
};

const DangerRow = ({
  title,
  description,
  label,
  testId,
  destructive = false,
  onClick,
}: {
  title: string;
  description: ReactNode;
  label: string;
  testId: string;
  destructive?: boolean;
  onClick: () => void;
}) => (
  <div className="flex items-center gap-4 px-3 py-3">
    <div className="min-w-0 flex-1">
      <h3 className="text-[13px] font-medium text-text">{title}</h3>
      <p className="mt-0.5 text-[12.5px] text-text-subtle">{description}</p>
    </div>
    <Button
      type="button"
      variant={destructive ? "destructive" : "secondary"}
      size="sm"
      data-testid={testId}
      onClick={onClick}
    >
      {label}
    </Button>
  </div>
);
