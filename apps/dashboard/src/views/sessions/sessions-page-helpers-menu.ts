import type { RuntimeConfigurationProvider } from "@aop/common";
import type { Dispatch, SetStateAction } from "react";
import type { ChatSessionDetail, ChatSessionSummary, updateChatSession } from "../../api/client";
import type { MenuState } from "./sessions-menu";
import { pinSessionOptimistic } from "./sessions-page-helpers";
import { getEffectiveCmd } from "./sessions-runtime";

export const menuHandlers = (args: {
  menu: MenuState;
  active: ChatSessionDetail | null;
  sessions: ChatSessionSummary[];
  termOpen: boolean;
  skills: string[];
  runtimeConfigurations: RuntimeConfigurationProvider[];
  patchSession: (
    sessionId: string,
    patch: Parameters<typeof updateChatSession>[1],
  ) => Promise<ChatSessionSummary>;
  /** Optimistic list update for pin/unpin before the server responds. */
  setSessions?: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  showToast: (message: string) => void;
  setRename: (value: { id: string; value: string } | null) => void;
  setMenu: Dispatch<SetStateAction<MenuState>>;
  setTermOpen: Dispatch<SetStateAction<boolean>>;
  sendSkill: (name: string) => void;
  settleSession?: (id: string, title: string) => Promise<void>;
  unsettleSession?: (id: string, title: string) => Promise<void>;
  onResetRuntime?: (id: string, active: boolean) => void;
  deleteSession?: (id: string, title: string) => Promise<void>;
}) => ({
  menu: args.menu.kind === "closed" ? { kind: "closed" as const } : args.menu,
  active: args.active,
  sessions: args.sessions,
  skills: args.skills,
  runtimeConfigurations: args.runtimeConfigurations,
  onRename: (id: string, title: string) => {
    args.setRename({ id, value: title });
    args.setMenu({ kind: "closed" });
  },
  onPin: (id: string, pinned: boolean) => {
    args.setMenu({ kind: "closed" });
    void pinSessionOptimistic({
      sessionId: id,
      pinned,
      sessions: args.sessions,
      setSessions: args.setSessions,
      patchSession: args.patchSession,
      showToast: args.showToast,
    });
  },
  onSettle: (id: string, title: string) => {
    args.setMenu({ kind: "closed" });
    if (args.settleSession) {
      void args.settleSession(id, title);
      return;
    }
    void args
      .patchSession(id, { settledOverride: "settled", pinned: false })
      .then(() => args.showToast(`Settled · ${title}`));
  },
  onUnsettle: (id: string, title: string) => {
    args.setMenu({ kind: "closed" });
    if (args.unsettleSession) {
      void args.unsettleSession(id, title);
      return;
    }
    void args
      .patchSession(id, { settledOverride: "active" })
      .then(() => args.showToast(`Un-settled · ${title}`));
  },
  onResetRuntime: (id: string, active: boolean) => {
    args.setMenu({ kind: "closed" });
    args.onResetRuntime?.(id, active);
  },
  onDelete: (id: string, title: string) => {
    args.setMenu({ kind: "closed" });
    if (args.deleteSession) void args.deleteSession(id, title);
  },
  onRuntime: (runtime: string) => {
    if (!args.active) return;
    const configuration = args.runtimeConfigurations.find((item) => item.id === runtime);
    void args.patchSession(
      args.active.id,
      configuration ? { runtimeConfigurationId: configuration.id } : { runtime },
    );
    args.setMenu({ kind: "closed" });
  },
  onModel: (model: string) => {
    if (!args.active) return;
    void args.patchSession(args.active.id, { model });
    args.setMenu({ kind: "closed" });
  },
  onEffort: (effort: string) => {
    if (!args.active) return;
    void args.patchSession(args.active.id, { reasoningEffort: effort });
    args.setMenu({ kind: "closed" });
  },
  onFastMode: (fastMode: boolean) => {
    if (!args.active) return;
    void args.patchSession(args.active.id, { fastMode });
    args.setMenu({ kind: "closed" });
  },
  onSkills: () =>
    args.setMenu((current) =>
      current.kind === "closed" ? current : { ...current, kind: "cskills" },
    ),
  onSkillPick: (name: string) => {
    args.setMenu({ kind: "closed" });
    args.sendSkill(name);
  },
});

export const effectiveCmdLabel = (
  active: Pick<ChatSessionDetail, "runtime" | "runtimeAlias"> | null,
): string => (active ? getEffectiveCmd(active.runtime, active.runtimeAlias) : "");
