import { formatRuntimeModelLabel, getThinkingLabel, type Thread } from "@aop/common";

const CHIP_CLASS =
  "flex h-7 min-w-0 items-center whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium text-text-muted";

/**
 * The model and effort the thread runs on, in the composer's footer. A thread keeps the ones
 * it started with; a change to the project's thread settings applies to the threads it starts next.
 */
export const ThreadRuntimeChips = ({ thread }: { thread: Thread }) => (
  <>
    <span
      data-testid="thread-model"
      title="The model this thread runs on. Change it for new threads in the project settings."
      className={`${CHIP_CLASS} max-w-48 truncate`}
    >
      {formatRuntimeModelLabel(thread.runtime.model)}
    </span>
    <span data-testid="thread-effort" className={CHIP_CLASS}>
      {getThinkingLabel(thread.runtime.provider, thread.runtime.effort)}
    </span>
  </>
);
