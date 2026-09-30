import {
  type RuntimeConfigurationProvider,
  runtimeConfigurationSupportsFastMode,
} from "@aop/common";
import { createElement, type ReactNode } from "react";
import type { MenuListItem } from "@/ui/menu-panel";
import type {
  ChatSessionDetail,
  ChatSessionSummary,
  SessionPullRequestState,
} from "../../api/client";
import { canSettleSession, isSessionSettled } from "./session-settled";
import {
  EFFORT_OPTIONS,
  getEffortLabel,
  getModelLabel,
  getRuntimeUi,
  modelOptionsFor,
  RUNTIME_LIST,
} from "./sessions-runtime";

const menuIcon = (paths: string | readonly string[]): ReactNode => {
  const list = typeof paths === "string" ? [paths] : paths;
  return createElement(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      style: { flexShrink: 0, opacity: 0.75 },
    },
    ...list.map((d) => createElement("path", { key: d, d })),
  );
};

const ICONS = {
  rename: "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  pin: ["M9 4h6v6l2 4v1H7v-1l2-4z", "M12 15v6"],
  settle: "M5 12l4 4L19 6",
  unsettle: ["M3 7v6h6", "M21 17a9 9 0 0 0-15-6.7L3 13"],
  delete: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"],
  resetRuntime: ["M3 12a9 9 0 1018 0 9 9 0 00-18 0", "M12 7v5l3 2"],
} as const;

export type SessionsMenuKind = "closed" | "sessmenu" | "cconfig" | "cskills";

export interface SessionsMenuState {
  kind: SessionsMenuKind;
  anchor?: DOMRect;
  sessionId?: string;
}

export type MenuState =
  | { kind: "closed" }
  | {
      kind: Exclude<SessionsMenuKind, "closed">;
      anchor: DOMRect;
      sessionId?: string;
    };

export interface SessionsRepo {
  id: string;
  name: string | null;
  path: string;
}

export const menuTitle = (kind: SessionsMenuKind, cmd?: string): string | undefined => {
  const titles: Partial<Record<SessionsMenuKind, string>> = {
    cconfig: "RUNTIME SETTINGS",
    cskills: cmd ? `SKILLS · ${cmd.toUpperCase()}` : "SKILLS",
  };
  return titles[kind];
};

export const menuMinWidth = (kind: SessionsMenuKind): number => {
  if (kind === "sessmenu") return 190;
  if (kind === "cconfig") return 250;
  if (kind === "cskills") return 220;
  return 200;
};

export interface MenuItemBuilders {
  menu: SessionsMenuState;
  active: ChatSessionDetail | null;
  sessions: ChatSessionSummary[];
  skills: string[];
  runtimeConfigurations?: RuntimeConfigurationProvider[];
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onSettle: (id: string, title: string) => void;
  onUnsettle: (id: string, title: string) => void;
  onResetRuntime?: (id: string, active: boolean) => void;
  now?: string;
  pullRequestState?: SessionPullRequestState | null;
  onDelete: (id: string, title: string) => void;
  onRuntime: (runtime: string) => void;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  onFastMode?: (fastMode: boolean) => void;
  onSkillPick: (name: string) => void;
}

export const buildMenuItems = (args: MenuItemBuilders): MenuListItem[] => {
  switch (args.menu.kind) {
    case "sessmenu":
      return sessmenuItems(args);
    case "cconfig":
      return configurationItems(args);
    case "cskills":
      return skillItems(args);
    default:
      return [];
  }
};

const sessmenuItems = (args: MenuItemBuilders): MenuListItem[] => {
  const sessionId = args.menu.sessionId;
  if (!sessionId) return [];
  const target =
    args.sessions.find((s) => s.id === sessionId) ??
    (args.active?.id === sessionId ? args.active : null);
  if (!target) return [];
  const settled = isSessionSettled(target, {
    now: args.now ?? new Date().toISOString(),
    pullRequestState: args.pullRequestState,
  });
  const hasActiveRun = Boolean(target.assistantActive);

  if (settled) {
    return [
      {
        id: "unsettle",
        label: "Un-settle thread",
        icon: menuIcon(ICONS.unsettle),
        onSelect: () => args.onUnsettle(sessionId, target.title),
      },
      {
        id: "reset-runtime",
        label: "Reset runtime session",
        icon: menuIcon(ICONS.resetRuntime),
        onSelect: () => args.onResetRuntime?.(sessionId, hasActiveRun),
      },
      {
        id: "rename",
        label: "Rename thread",
        icon: menuIcon(ICONS.rename),
        onSelect: () => args.onRename(sessionId, target.title),
      },
      {
        id: "delete",
        label: "Delete",
        icon: menuIcon(ICONS.delete),
        onSelect: () => args.onDelete(sessionId, target.title),
      },
    ];
  }

  const pinned = target.pinned;
  const items: MenuListItem[] = [
    {
      id: "rename",
      label: "Rename",
      icon: menuIcon(ICONS.rename),
      onSelect: () => args.onRename(sessionId, target.title),
    },
    {
      id: "pin",
      label: pinned ? "Unpin" : "Pin to top",
      icon: menuIcon(ICONS.pin),
      onSelect: () => args.onPin(sessionId, !pinned),
    },
    {
      id: "settle",
      label: "Settle",
      icon: menuIcon(ICONS.settle),
      disabled: !canSettleSession(target),
      onSelect: () => args.onSettle(sessionId, target.title),
    },
    {
      id: "delete",
      label: "Delete",
      icon: menuIcon(ICONS.delete),
      onSelect: () => args.onDelete(sessionId, target.title),
    },
  ];
  const hasRuntimeBinding = Boolean(target.runtimeSessionId);
  if ((hasRuntimeBinding || hasActiveRun) && args.onResetRuntime) {
    items.push({
      id: "reset-runtime",
      label: "Reset runtime session",
      icon: menuIcon(ICONS.resetRuntime),
      separatorBefore: true,
      onSelect: () => args.onResetRuntime?.(sessionId, hasActiveRun),
    });
  }
  return items;
};

const menuHeader = (id: string, label: string): MenuListItem => ({
  id,
  label,
  header: true,
  disabled: true,
  dimmed: true,
  onSelect: () => {},
});

const runtimeItems = (args: MenuItemBuilders): MenuListItem[] => {
  const configurations = (args.runtimeConfigurations ?? []).filter(
    (configuration) => configuration.driver !== "custom" && configuration.models.length > 0,
  );
  if (configurations.length > 0) {
    return configurations.map((configuration) => {
      const ui = getRuntimeUi(configuration.driver);
      return {
        id: configuration.id,
        label: configuration.name,
        dot: ui.color,
        sub: configuration.command,
        check: args.active?.runtimeConfigurationId === configuration.id,
        onSelect: () => args.onRuntime(configuration.id),
      };
    });
  }

  return RUNTIME_LIST.map((rt) => ({
    id: rt.key,
    label: rt.label,
    dot: rt.color,
    sub: rt.cmd,
    check: args.active?.runtime === rt.key,
    onSelect: () => args.onRuntime(rt.key),
  }));
};

const modelItems = (args: MenuItemBuilders): MenuListItem[] => {
  if (!args.active) return [];
  const configuration = args.runtimeConfigurations?.find(
    (item) => item.id === args.active?.runtimeConfigurationId,
  );
  if (configuration) {
    return configuration.models.map((item) => ({
      id: item.model,
      label: item.description.trim() || getModelLabel(item.model),
      mono: true,
      sub: item.model,
      check: args.active?.model === item.model,
      onSelect: () => args.onModel(item.model),
    }));
  }
  return modelOptionsFor(args.active.runtime).map((model) => ({
    id: model,
    label: getModelLabel(model),
    mono: true,
    sub: model,
    check: args.active?.model === model,
    onSelect: () => args.onModel(model),
  }));
};

const effortItems = (args: MenuItemBuilders): MenuListItem[] => {
  if (!args.active) return [];
  const configuration = args.runtimeConfigurations?.find(
    (item) => item.id === args.active?.runtimeConfigurationId,
  );
  // When a config is bound, never fall back to the full catalog if the model was removed —
  // use the configured default model row (or empty) so thinking stays settings-scoped.
  const model = configuration
    ? (configuration.models.find((item) => item.model === args.active?.model) ??
      configuration.models.find((item) => item.isDefault) ??
      configuration.models[0])
    : undefined;
  const options = configuration
    ? EFFORT_OPTIONS.filter((option) => model?.thinkingLevels.includes(option.value))
    : EFFORT_OPTIONS;
  return options.map((option) => ({
    id: option.value,
    label: getEffortLabel(
      args.active?.runtime ?? "claude-code",
      option.value,
      model?.model ?? args.active?.model,
    ),
    check: args.active?.reasoningEffort === option.value,
    onSelect: () => args.onEffort(option.value),
  }));
};

const configurationItems = (args: MenuItemBuilders): MenuListItem[] => {
  if (!args.active) return [];
  const configuration = args.runtimeConfigurations?.find(
    (item) => item.id === args.active?.runtimeConfigurationId,
  );
  const items: MenuListItem[] = [
    menuHeader("header-runtime", "RUNTIME"),
    ...runtimeItems(args),
    menuHeader("header-model", "MODEL"),
    ...modelItems(args),
  ];

  const thinking = effortItems(args);
  if (thinking.length > 0) {
    items.push(menuHeader("header-thinking", "THINKING"), ...thinking);
  }

  items.push(...configurationFastItems(args, configuration));
  return items;
};

const configurationFastItems = (
  args: MenuItemBuilders,
  configuration: RuntimeConfigurationProvider | undefined,
): MenuListItem[] => {
  if (!args.active || !args.onFastMode) return [];
  const supportsFast =
    (configuration &&
      runtimeConfigurationSupportsFastMode(configuration, args.active.model ?? "")) ||
    (!configuration && (args.active.runtime === "codex-cli" || args.active.runtime === "pi"));
  if (!supportsFast) return [];
  return [
    menuHeader("header-fast", "FAST"),
    {
      id: "fast",
      label: "Fast mode",
      check: args.active.fastMode,
      onSelect: () => args.onFastMode?.(!args.active?.fastMode),
    },
  ];
};

const skillItems = (args: MenuItemBuilders): MenuListItem[] => {
  const rt = args.active ? getRuntimeUi(args.active.runtime) : getRuntimeUi("claude-code");
  return args.skills.map((skill) => ({
    id: skill,
    label: `/${skill}`,
    mono: true,
    sub: rt.cmd,
    dot: rt.color,
    onSelect: () => args.onSkillPick(skill),
  }));
};
