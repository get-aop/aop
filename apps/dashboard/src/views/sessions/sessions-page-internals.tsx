import {
  type RuntimeConfigurationProvider,
  type RuntimeProfile,
  runtimeConfigurationSupportsFastMode,
} from "@aop/common";
import { ChevronLeftIcon } from "lucide-react";
import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
import type { MenuListItem } from "@/ui/menu-panel";
import type { ChatSessionDetail, ChatSessionSummary, SessionGitStatus } from "../../api/client";
import { RuntimeProfilePicker } from "../../components/RuntimeProfilePicker";
import type { Agent } from "../../types";
import { SessionChangedFilesCard } from "./SessionChangedFilesCard";
import {
  type MenuItemBuilders,
  type MenuState,
  type ParentMenuKind,
  parentMenuFor,
  parentMenuLabel,
} from "./sessions-menu";
import { menuHandlers } from "./sessions-page-helpers";

export const runtimeAccessModeFor = (
  session: ChatSessionDetail,
): NonNullable<ChatSessionDetail["runtimeAccessMode"]> =>
  session.runtimeAccessMode ?? "full-access";

export const patchComposerSetting = (
  update: () => Promise<unknown>,
  showToast: (message: string) => void,
  fallbackMessage: string,
): void => {
  void update().catch((error: unknown) =>
    showToast(error instanceof Error ? error.message : fallbackMessage),
  );
};

export const isDraftSession = (
  session: ChatSessionDetail | null,
  assistantActive: boolean,
): boolean => Boolean(session && session.messages.length === 0 && !assistantActive);

export const SessionDetailLoading = ({
  loading,
  active,
}: {
  loading: boolean;
  active: ChatSessionDetail | null;
}) => {
  if (!loading || active) return null;
  return (
    <div
      data-testid="session-detail-loading"
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <span style={{ animation: "aop-blink 1.1s ease-in-out infinite" }}>Loading chat…</span>
    </div>
  );
};

export const SessionChangedFilesSlot = ({
  session,
  gitStatus,
  refreshKey,
  onOpenFile,
}: {
  session: ChatSessionDetail;
  gitStatus: SessionGitStatus | null;
  refreshKey: number;
  onOpenFile: (path: string) => void;
}) => {
  if (session.messages.length === 0 || !session.workspacePath || !gitStatus?.dirty) return null;
  return (
    <SessionChangedFilesCard
      sessionId={session.id}
      refreshKey={refreshKey}
      onOpenFile={onOpenFile}
    />
  );
};

export const SessionRuntimeProfiles = ({
  profiles,
  onApply,
}: {
  profiles: RuntimeProfile[];
  onApply: (profile: RuntimeProfile) => void;
}) => {
  if (profiles.length === 0) return null;
  return (
    <div className="border-t border-border bg-surface px-4 py-2">
      <RuntimeProfilePicker profiles={profiles} onApply={onApply} />
    </div>
  );
};

export const parentMenuKindFor = parentMenuFor;

export const composerMenuAppearance = (kind: MenuState["kind"]): "composer" | "default" =>
  kind.startsWith("c") ? "composer" : "default";

export const withMenuBackItem = (
  items: MenuListItem[],
  parent: ParentMenuKind | null,
  onBack: () => void,
): MenuListItem[] => {
  if (!parent) return items;
  return [
    {
      id: "back",
      label: parentMenuLabel(parent),
      icon: <ChevronLeftIcon className="size-3.5" strokeWidth={1.7} />,
      onSelect: onBack,
    },
    ...items.map((item, index) => ({ ...item, separatorBefore: index === 0 })),
  ];
};

export const closeOrBackMenu = (
  setMenu: Dispatch<SetStateAction<MenuState>>,
  parent: ParentMenuKind | null,
) => {
  if (parent) {
    setMenu((current) => moveMenuToParent(current, parent));
    return;
  }
  setMenu({ kind: "closed" });
};

export const moveMenuToParent = (menu: MenuState, parent: ParentMenuKind): MenuState =>
  menu.kind === "closed" ? menu : { ...menu, kind: parent };

export const buildComposerMenuArgs = (input: {
  handlers: Parameters<typeof menuHandlers>[0];
  composer: {
    input: string;
    setInput: (value: string) => void;
    send: (value?: string) => Promise<unknown> | undefined;
    imageInputRef: { current: HTMLInputElement | null };
    documentInputRef: { current: HTMLInputElement | null };
    imageLimitReached: boolean;
    documentLimitReached: boolean;
  };
  setMenu: Dispatch<SetStateAction<MenuState>>;
  agents: Agent[];
  workflowNames: string[];
  patchSession: Parameters<typeof menuHandlers>[0]["patchSession"];
  active: ChatSessionDetail | null;
}): MenuItemBuilders => ({
  ...menuHandlers(input.handlers),
  onControlCommand: (command) => {
    input.composer.setInput(appendControlMarker(input.composer.input, `$${command}`));
    input.setMenu({ kind: "closed" });
  },
  onGoal: () => {
    input.setMenu({ kind: "closed" });
    void input.composer.send("/goal");
  },
  workers: input.agents.map((agent) => ({ id: agent.id, name: agent.name })),
  workflows: input.workflowNames,
  imageLimitReached: input.composer.imageLimitReached,
  documentLimitReached: input.composer.documentLimitReached,
  onOpenSection: (kind) =>
    input.setMenu((current) => (current.kind === "closed" ? current : { ...current, kind })),
  onAttachImage: () => {
    input.composer.imageInputRef.current?.click();
    input.setMenu({ kind: "closed" });
  },
  onAttachDocument: () => {
    input.composer.documentInputRef.current?.click();
    input.setMenu({ kind: "closed" });
  },
  onWorker: (workerId) => {
    if (input.active) void input.patchSession(input.active.id, { defaultWorkerId: workerId });
    input.setMenu({ kind: "closed" });
  },
  onWorkflow: (workflowId) => {
    if (input.active) void input.patchSession(input.active.id, { defaultWorkflowId: workflowId });
    input.setMenu({ kind: "closed" });
  },
});

export const appendControlMarker = (input: string, marker: string): string =>
  input.trim() ? `${input.trimEnd()} ${marker} ` : `${marker} `;

/** Session-scoped typing so activity from session A cannot mark session B busy. */
export const useSessionScopedTyping = (
  activeId: string | null,
  activeIdRef: { current: string | null },
): {
  typing: boolean;
  setTyping: (value: boolean) => void;
  clearSessionTyping: (sessionId: string) => void;
} => {
  const [typingBySession, setTypingBySession] = useState<Record<string, boolean>>({});
  const typing = Boolean(activeId && typingBySession[activeId]);
  const setTyping = useCallback(
    (value: boolean) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      setTypingBySession((current) => updateSessionTypingMap(current, sessionId, value));
    },
    [activeIdRef],
  );
  const clearSessionTyping = useCallback((sessionId: string) => {
    setTypingBySession((current) => updateSessionTypingMap(current, sessionId, false));
  }, []);
  return { typing, setTyping, clearSessionTyping };
};

export const updateSessionTypingMap = (
  current: Record<string, boolean>,
  sessionId: string,
  value: boolean,
): Record<string, boolean> => {
  if (value) {
    if (current[sessionId]) return current;
    return { ...current, [sessionId]: true };
  }
  if (!current[sessionId]) return current;
  const next = { ...current };
  delete next[sessionId];
  return next;
};

export const isAssistantConversationActive = (
  session: ChatSessionDetail | null,
  typing: boolean,
): boolean => {
  if (typing) return true;
  if (session?.assistantLifecycle) return session.assistantLifecycle !== "idle";
  return session?.assistantActive === true;
};

export type RuntimeConfigurationNameMap = ReadonlyMap<string, string>;

export const sessionSupportsFastMode = (
  session: Pick<ChatSessionDetail, "runtime" | "runtimeConfigurationId" | "model">,
  configurations: RuntimeConfigurationProvider[],
): boolean => {
  const configuration = configurations.find((item) => item.id === session.runtimeConfigurationId);
  if (configuration) return runtimeConfigurationSupportsFastMode(configuration, session.model);
  return session.runtime === "codex-cli" || session.runtime === "pi";
};

export const runtimeConfigurationNameMap = (
  configurations: RuntimeConfigurationProvider[],
): RuntimeConfigurationNameMap =>
  new Map(configurations.map((configuration) => [configuration.id, configuration.name]));

export const attachRuntimeConfigurationNames = (
  sessions: ChatSessionSummary[],
  names: RuntimeConfigurationNameMap,
): ChatSessionSummary[] =>
  sessions.map((session) => ({
    ...session,
    runtimeConfigurationName: runtimeConfigurationNameFor(session.runtimeConfigurationId, names),
  }));

export const runtimeConfigurationNameFor = (
  configurationId: string | null | undefined,
  names: RuntimeConfigurationNameMap,
): string | null => (configurationId ? (names.get(configurationId) ?? null) : null);

export * from "./sessions-page-actions";
export * from "./sessions-page-binding";
export * from "./sessions-page-git";
export * from "./sessions-page-panels";
