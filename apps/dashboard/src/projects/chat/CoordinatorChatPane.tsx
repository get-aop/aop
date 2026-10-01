import type { Message, Project, Thread } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChatEmpty,
  ChatError,
  ChatLoading,
  ChatRefreshNotice,
  disabledReasonOf,
  ProjectClosedNotice,
} from "./ChatStates";
import { Composer } from "./Composer";
import { CoordinatorChips } from "./CoordinatorChips";
import { ChatProvider } from "./chat-context";
import { earlierOf, isWorking } from "./chat-state";
import { MessageList } from "./MessageList";
import type { ChatModel, ProjectChat } from "./project-chat";
import { UsageTip } from "./UsageTip";

/**
 * The conversation with a project's coordinator: what was said, what it is writing now, the
 * cards of the threads it started, and the box to say more. The chat itself lives above (see
 * `useProjectChat`), so it keeps following the project while another tab is open.
 */
export const CoordinatorChatPane = ({
  project,
  threads,
  threadsLoaded,
  threadsError,
  chat,
  model,
  active = true,
}: {
  project: Project;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  threadsError: string | null;
  chat: ProjectChat;
  model: ChatModel;
  /** Whether the pane is on screen; replies are only read while it is. */
  active?: boolean;
}) => {
  const visible = usePageVisible() && active;
  const projectActive = project.status === "active";
  const working = projectActive && isWorking(model);
  const firstNewId = useFirstNewId(model);
  const latestId = model.messages.at(-1)?.id ?? null;

  // Whatever is on screen while the page is looked at counts as read.
  useEffect(() => {
    if (visible && model.phase === "ready" && latestId !== null) chat.markSeen();
  }, [visible, model.phase, latestId, chat]);

  // Saying something takes the person to the bottom, where the answer will be.
  const [sentCount, setSentCount] = useState(0);
  const send = useCallback(
    async (text: string) => {
      const result = await chat.send(text);
      if (result.ok) setSentCount((count) => count + 1);
      return result;
    },
    [chat],
  );
  const startWith = useCallback(
    async (text: string) => {
      const result = await send(text);
      if (!result.ok) toast.error(result.error);
    },
    [send],
  );

  return (
    <div
      data-testid="coordinator-chat-pane"
      data-project-id={project.id}
      data-phase={model.phase}
      data-working={working}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ChatProvider
        projectId={project.id}
        projectActive={projectActive}
        threads={threads}
        threadsLoaded={threadsLoaded}
        threadsError={threadsError}
      >
        <Body
          model={model}
          project={project}
          working={working}
          firstNewId={firstNewId}
          sentCount={sentCount}
          chat={chat}
          onStart={startWith}
        />
        <footer className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4 pt-2">
          {model.phase === "ready" && model.loadError ? (
            <ChatRefreshNotice message={model.loadError} />
          ) : null}
          {projectActive ? <UsageTip /> : <ProjectClosedNotice project={project} />}
          <Composer
            key={project.id}
            draftId={project.id}
            focusKey={project.id}
            placeholder="Ask the coordinator a question or start a task…"
            disabledReason={disabledReasonOf(project)}
            send={send}
            chips={<CoordinatorChips project={project} />}
          />
        </footer>
      </ChatProvider>
    </div>
  );
};

const Body = ({
  model,
  project,
  working,
  firstNewId,
  sentCount,
  chat,
  onStart,
}: {
  model: ChatModel;
  project: Project;
  working: boolean;
  firstNewId: string | null;
  sentCount: number;
  chat: ProjectChat;
  onStart: (text: string) => void;
}) => {
  if (model.phase === "loading") {
    return model.loadError ? (
      <ChatError message={model.loadError} onRetry={chat.reload} />
    ) : (
      <ChatLoading />
    );
  }
  if (model.messages.length === 0 && !working) {
    return <ChatEmpty project={project} canStart={project.status === "active"} onStart={onStart} />;
  }
  return (
    <MessageList
      messages={model.messages}
      live={model.live}
      working={working}
      firstNewId={firstNewId}
      scrollToEndKey={sentCount}
      earlier={earlierOf(model, chat.loadEarlier)}
    />
  );
};

/**
 * The first message this device had not looked at when the chat opened, so a "New" line can
 * mark where it starts. It is fixed for as long as the chat stays open: what arrives while the
 * person is reading is not new to them.
 */
const useFirstNewId = (model: ChatModel): string | null => {
  const fixed = useRef<{ id: string | null } | null>(null);
  if (fixed.current === null && model.phase === "ready") {
    fixed.current = { id: firstUnseenId(model.messages, model.seenAt) };
  }
  return fixed.current?.id ?? null;
};

const firstUnseenId = (messages: readonly Message[], seenAt: string | null): string | null => {
  if (seenAt === null) return null;
  const since = Date.parse(seenAt);
  return (
    messages.find((message) => message.role !== "user" && Date.parse(message.createdAt) > since)
      ?.id ?? null
  );
};

const usePageVisible = (): boolean => {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
};
