import type { Thread } from "@aop/common";
import { effortLabel, modelLabel } from "../chat/runtime-options";
import { useProjectEntry } from "../ProjectsProvider";

const CHIP_CLASS =
  "flex h-8 min-w-0 items-center whitespace-nowrap rounded-lg px-2 text-meta font-medium text-text-muted";

/**
 * The model and effort the thread runs on, in the composer's footer. A thread keeps the ones
 * it started with; a change to the project's thread settings applies to the threads it starts next.
 * A thread on "Use default" names none: Claude Code picks its own, so the chips show what the
 * project's last thread run reported it picked, or say "Default" before one has.
 */
export const ThreadRuntimeChips = ({ thread }: { thread: Thread }) => {
  const reported = useProjectEntry(thread.projectId)?.project.reportedRuntime.thread;
  return (
    <>
      <span
        data-testid="thread-model"
        title={
          thread.runtime.model === null
            ? "This thread was started on “Use default”, so Claude Code picks its model. Change it for new threads in the project settings."
            : "The model this thread runs on. Change it for new threads in the project settings."
        }
        className={`${CHIP_CLASS} max-w-48 truncate`}
      >
        {modelLabel(thread.runtime, [], reported)}
      </span>
      <span data-testid="thread-effort" className={CHIP_CLASS}>
        {effortLabel(thread.runtime, reported)}
      </span>
    </>
  );
};
