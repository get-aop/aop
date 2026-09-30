import type { Project, Thread } from "@aop/common";
import { THREAD_STATUS_LABEL } from "./selectors";

/**
 * The screens of a project that later work fills in. Each one already receives the data it
 * will need, typed, so replacing a body changes nothing in the shell:
 * - `ThreadPane`: one thread's transcript and its own composer.
 * The project's settings are built: see `settings/ProjectSettingsPane.tsx`. The coordinator
 * chat is built too: see `chat/CoordinatorChatPane.tsx`.
 */

export const ThreadPane = ({ thread }: { project: Project; thread: Thread | undefined }) =>
  thread ? (
    <PanePlaceholder
      testId="thread-pane"
      title={thread.title}
      detail={`${THREAD_STATUS_LABEL[thread.status]}. This thread's transcript will open here.`}
    />
  ) : (
    <PanePlaceholder
      testId="thread-not-found"
      title="Thread not found"
      detail="It may have been deleted, or it belongs to another project."
    />
  );

const PanePlaceholder = ({
  testId,
  title,
  detail,
}: {
  testId: string;
  title: string;
  detail: string;
}) => (
  <div
    data-testid={testId}
    className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-16 text-center"
  >
    <h2 className="text-[14px] font-medium text-text">{title}</h2>
    <p className="max-w-sm text-[13px] text-text-subtle">{detail}</p>
  </div>
);
