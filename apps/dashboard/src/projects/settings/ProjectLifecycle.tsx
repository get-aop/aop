import type { Project } from "@aop/common";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { useProjectActions } from "../use-project-actions";
import { SettingRow, SettingsHeading } from "./blocks";

/**
 * The actions that are not edits: pause, restart the coordinator and archive as plain rows, each
 * behind a question since they stop work, then Delete alone under "Danger zone".
 */
export const ProjectLifecycle = ({ project }: { project: Project }) => (
  <div data-testid="settings-lifecycle" className="flex flex-col">
    <SettingsHeading title="Project" />
    {project.status === "archived" ? null : <PauseRow project={project} />}
    <RestartRow project={project} />
    <ArchiveRow project={project} />
    <div data-testid="settings-danger-zone" className="flex flex-col">
      <SettingsHeading title="Danger zone" />
      <DeleteRow project={project} />
    </div>
  </div>
);

const ask = async (
  options: { title: string; message: string; confirmLabel: string },
  run: () => Promise<void>,
) => {
  if (await requestConfirmation(options)) await run();
};

const PauseRow = ({ project }: { project: Project }) => {
  const actions = useProjectActions();
  if (project.status === "paused") {
    return (
      <ActionRow
        label="Resume project"
        description="Lets the coordinator and threads run again."
        testId="settings-pause"
        icon={<PlayIcon />}
        action="Resume"
        onClick={() => void actions.transition(project, "resume")}
      />
    );
  }
  return (
    <ActionRow
      label="Pause project"
      description="Stops the coordinator and every running thread, and refuses new messages until you resume. This can be undone at any time."
      testId="settings-pause"
      icon={<PauseIcon />}
      action="Pause"
      onClick={() =>
        void ask(
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
  );
};

/** Starts the coordinator over with a fresh session; the chat and the threads stay. */
const RestartRow = ({ project }: { project: Project }) => {
  const actions = useProjectActions();
  return (
    <ActionRow
      label="Restart coordinator"
      description="If the coordinator is stuck or has lost the thread, restart it. Threads keep running."
      testId="settings-restart-coordinator"
      icon={<RotateCwIcon />}
      action="Restart"
      disabled={project.status === "archived"}
      onClick={() =>
        void ask(
          {
            title: "Restart the coordinator?",
            message:
              "It starts a new session and re-reads the instructions and memory. The chat stays, and no thread is touched or stopped.",
            confirmLabel: "Restart coordinator",
          },
          () => actions.restartCoordinator(project),
        )
      }
    />
  );
};

const ArchiveRow = ({ project }: { project: Project }) => {
  const actions = useProjectActions();
  if (project.status === "archived") {
    return (
      <ActionRow
        label="Restore project"
        description="Brings the project back to the sidebar."
        testId="settings-archive"
        icon={<ArchiveRestoreIcon />}
        action="Restore"
        onClick={() => void actions.transition(project, "restore")}
      />
    );
  }
  return (
    <ActionRow
      label="Archive project"
      description="Stops all work and moves the project out of the way. Threads and memory are kept."
      testId="settings-archive"
      icon={<ArchiveIcon />}
      action="Archive"
      onClick={() =>
        void ask(
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
  );
};

const DeleteRow = ({ project }: { project: Project }) => {
  const actions = useProjectActions();
  return (
    <SettingRow
      label="Delete project"
      description="Deletes its threads, chat and memory for good. Repositories stay attached to AOP."
      control={
        <Button
          type="button"
          size="sm"
          data-testid="settings-delete"
          className="bg-blocked text-white hover:bg-blocked/90"
          onClick={() => void actions.remove(project)}
        >
          <Trash2Icon />
          Delete
        </Button>
      }
    />
  );
};

const ActionRow = ({
  label,
  description,
  testId,
  icon,
  action,
  disabled = false,
  onClick,
}: {
  label: string;
  description: string;
  testId: string;
  icon: ReactNode;
  action: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <SettingRow
    label={label}
    description={description}
    control={
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        {action}
      </Button>
    }
  />
);
