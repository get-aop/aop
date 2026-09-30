import { CLI_PROVIDER_LABELS, type Project, type Thread } from "@aop/common";
import { useCallback, useMemo, useState } from "react";
import { ChatError, ChatLoading, ChatRefreshNotice, ProjectClosedNotice } from "../chat/ChatStates";
import { Composer } from "../chat/Composer";
import { ChatProvider } from "../chat/chat-context";
import type { ChatState } from "../chat/chat-state";
import { MessageList, type Worker } from "../chat/MessageList";
import type { SendResult } from "../chat/project-chat";
import { type ThreadActions, threadActions } from "../thread-actions";
import { AnswerCard } from "./AnswerCard";
import { ThreadProgress } from "./ThreadProgress";
import { ThreadRuntimeChips } from "./ThreadRuntimeChips";
import { useThreadActivity } from "./use-thread-activity";
import { useThreadConversation } from "./use-thread-conversation";
import { WorkLog } from "./WorkLog";

// A thread in these statuses has a turn running or lined up: Stop ends it.
const STOPPABLE = new Set<Thread["status"]>(["working", "queued", "rate-limited"]);

/**
 * The thread's own conversation: the brief it was given, what the agent said and did, and what
 * the person said back, with the agent's live text as it is written. Below it, the box to steer
 * the thread; while the thread waits on a question, the question and its answers instead.
 */
export const ThreadTranscript = ({
  project,
  thread,
  threads,
  threadsLoaded,
  threadsError,
}: {
  project: Project;
  thread: Thread;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  threadsError: string | null;
}) => {
  const { conversation, state } = useThreadConversation(project.id, thread.id);
  const agentReplies = state.messages.filter((message) => message.role === "assistant").length;
  const activity = useThreadActivity(thread, agentReplies);
  const [sentCount, setSentCount] = useState(0);
  const working = thread.status === "working" || Object.keys(state.live).length > 0;
  const worker = useMemo(
    () => ({ name: CLI_PROVIDER_LABELS[thread.runtime.provider], testIdPrefix: "thread" }),
    [thread.runtime.provider],
  );

  // What the person sent shows at once from the stream; fetching too covers a stream that is down.
  const sender = useCallback(
    (action: ThreadActions["steer"]) =>
      async (text: string): Promise<SendResult> => {
        const result = await action(thread, text);
        if (result.ok) {
          conversation.reload();
          setSentCount((count) => count + 1);
        }
        return result;
      },
    [thread, conversation],
  );
  const steer = useMemo(() => sender(threadActions.steer), [sender]);
  const answer = useMemo(() => sender(threadActions.reply), [sender]);
  const disabledReason = composerDisabledReason(project, thread);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadProgress thread={thread} />
      <ChatProvider
        projectId={project.id}
        projectActive={project.status === "active"}
        threads={threads}
        threadsLoaded={threadsLoaded}
        threadsError={threadsError}
      >
        <Body
          state={state}
          working={working}
          sentCount={sentCount}
          worker={worker}
          workLogOf={(id) => {
            const turn = activity.finished.get(id);
            return turn ? <WorkLog turn={turn} /> : null;
          }}
          liveWorkLog={activity.running ? <WorkLog turn={activity.running} /> : null}
          onReload={conversation.reload}
        />
      </ChatProvider>
      <footer className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4 pt-2">
        {state.phase === "ready" && state.loadError ? (
          <ChatRefreshNotice message={state.loadError} />
        ) : null}
        {project.status === "active" ? null : <ProjectClosedNotice project={project} />}
        {thread.status === "waiting-on-you" ? (
          <AnswerCard thread={thread} answer={answer} disabledReason={disabledReason} />
        ) : (
          <Composer
            key={thread.id}
            draftId={thread.id}
            focusKey={thread.id}
            placeholder="Steer this thread…"
            disabledReason={disabledReason}
            send={steer}
            chips={<ThreadRuntimeChips thread={thread} />}
            onStop={
              STOPPABLE.has(thread.status) ? () => void threadActions.stop(thread) : undefined
            }
          />
        )}
      </footer>
    </div>
  );
};

const Body = ({
  state,
  working,
  sentCount,
  worker,
  workLogOf,
  liveWorkLog,
  onReload,
}: {
  state: ChatState;
  working: boolean;
  sentCount: number;
  worker: Worker;
  workLogOf: (messageId: string) => React.ReactNode;
  liveWorkLog: React.ReactNode;
  onReload: () => void;
}) => {
  if (state.phase === "loading") {
    return state.loadError ? (
      <ChatError message={state.loadError} onRetry={onReload} />
    ) : (
      <ChatLoading />
    );
  }
  if (state.messages.length === 0 && !working) {
    return (
      <p
        data-testid="thread-empty"
        className="flex-1 px-6 py-16 text-center text-[13px] text-text-subtle"
      >
        Nothing has been said in this thread yet.
      </p>
    );
  }
  return (
    <MessageList
      messages={state.messages}
      live={state.live}
      working={working}
      firstNewId={null}
      scrollToEndKey={sentCount}
      worker={worker}
      workLogOf={workLogOf}
      liveWorkLog={liveWorkLog}
      workingSince={firstTurnStart(state)}
    />
  );
};

// A thread's first turn answers the brief, which is the only message then: that is when it began.
// Any later turn is counted from the message that started it, which the list knows.
const firstTurnStart = (state: ChatState): string | null =>
  state.messages.length === 1 ? (state.messages[0]?.createdAt ?? null) : null;

const composerDisabledReason = (project: Project, thread: Thread): string | null => {
  if (project.status === "paused") return "Paused. Resume the project to message this thread.";
  if (project.status === "archived") return "Archived. Restore the project to message this thread.";
  if (thread.status === "landing") {
    return "Merging the pull request. The thread takes no message until it is done.";
  }
  return null;
};
