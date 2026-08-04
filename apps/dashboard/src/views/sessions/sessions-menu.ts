import {
  CONTROL_COMMANDS,
  controlCommandLabel,
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
  browser: ["M3 5h18v14H3z", "M3 9h18", "M7 7h.01"],
  computer: ["M4 4h16v12H4z", "M8 20h8", "M12 16v4"],
  goal: [
    "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18",
    "M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10",
    "M12 12h.01",
  ],
  skills: "M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z",
  terminal: ["M4 17l6-5-6-5", "M12 19h8"],
  image: ["M3 5h18v14H3z", "M8 11l3 3 3-3 4 5"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v5h5"],
  worker: ["M12 12a4 4 0 100-8 4 4 0 000 8z", "M4 21a8 8 0 0116 0"],
  workflow: ["M6 3v6h6", "M18 21v-6h-6", "M6 9a9 9 0 0012 6"],
  resetRuntime: ["M3 12a9 9 0 1018 0 9 9 0 00-18 0", "M12 7v5l3 2"],
} as const;

export type SessionsMenuKind =
  | "closed"
  | "sessmenu"
  | "cconfig"
  | "cadd"
  | "cworker"
  | "cworkflow"
  | "cskills";

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

export type ParentMenuKind = "cadd";

export const parentMenuFor = (kind: MenuState["kind"]): ParentMenuKind | null => {
  if (kind === "cworker" || kind === "cworkflow") return "cadd";
  return null;
};

export const parentMenuLabel = (_parent: ParentMenuKind): string => "Add";

export interface SessionsRepo {
  id: string;
  name: string | null;
  path: string;
}

export const menuTitle = (kind: SessionsMenuKind, cmd?: string): string | undefined => {
  const titles: Partial<Record<SessionsMenuKind, string>> = {
    cconfig: "RUNTIME SETTINGS",
    cadd: "ADD",
    cworker: "SET WORKER",
    cworkflow: "SET WORKFLOW",
    cskills: cmd ? `SKILLS · ${cmd.toUpperCase()}` : "SKILLS",
  };
  return titles[kind];
};

export const menuMinWidth = (kind: SessionsMenuKind): number => {
  if (kind === "sessmenu") return 190;
  if (kind === "cadd") return 230;
  if (kind === "cconfig") return 250;
  if (kind === "cworker" || kind === "cworkflow") return 230;
  if (kind === "cskills") return 220;
  return 200;
};

export interface MenuItemBuilders {
  menu: SessionsMenuState;
  active: ChatSessionDetail | null;
  sessions: ChatSessionSummary[];
  skills: string[];
  runtimeConfigurations?: RuntimeConfigurationProvider[];
  workers?: Array<{ id: string; name: string }>;
  workflows?: string[];
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
  onControlCommand: (command: (typeof CONTROL_COMMANDS)[number]["id"]) => void;
  onGoal: () => void;
  onSkills: () => void;
  onSkillPick: (name: string) => void;
  onOpenSection?: (kind: "cworker" | "cworkflow") => void;
  onAttachImage?: () => void;
  onAttachDocument?: () => void;
  onWorker?: (workerId: string) => void;
  onWorkflow?: (workflowId: string) => void;
  imageLimitReached?: boolean;
  documentLimitReached?: boolean;
}

export const buildMenuItems = (args: MenuItemBuilders): MenuListItem[] => {
  switch (args.menu.kind) {
    case "sessmenu":
      return sessmenuItems(args);
    case "cconfig":
      return configurationItems(args);
    case "cadd":
      return addItems(args);
    case "cworker":
      return workerItems(args);
    case "cworkflow":
      return workflowItems(args);
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

/** Flat Add menu: Attach | Automation | Runtime controls, divided by separators. */
const addItems = (args: MenuItemBuilders): MenuListItem[] => {
  const attach: MenuListItem[] = [
    {
      id: "attach-image",
      label: "Attach image",
      icon: menuIcon(ICONS.image),
      disabled: args.imageLimitReached,
      onSelect: () => args.onAttachImage?.(),
    },
    {
      id: "attach-file",
      label: "Attach file (.md/.txt)",
      icon: menuIcon(ICONS.file),
      disabled: args.documentLimitReached,
      onSelect: () => args.onAttachDocument?.(),
    },
  ];

  const automation: MenuListItem[] = [
    {
      id: "worker",
      label: "Set worker",
      icon: menuIcon(ICONS.worker),
      separatorBefore: true,
      onSelect: () => args.onOpenSection?.("cworker"),
    },
    {
      id: "workflow",
      label: "Set workflow",
      icon: menuIcon(ICONS.workflow),
      onSelect: () => args.onOpenSection?.("cworkflow"),
    },
    {
      id: "goal",
      label: "Goal",
      icon: menuIcon(ICONS.goal),
      onSelect: args.onGoal,
    },
  ];
  if (args.skills.length > 0) {
    automation.push({
      id: "skills",
      label: "Skills",
      icon: menuIcon(ICONS.skills),
      onSelect: args.onSkills,
    });
  }

  const runtimeControls: MenuListItem[] = CONTROL_COMMANDS.map((command, index) => ({
    id: command.id.toLowerCase().replaceAll("_", "-"),
    label: controlCommandLabel(command),
    icon: controlMenuIcon(command.provider, command.capability),
    separatorBefore: index === 0,
    onSelect: () => args.onControlCommand(command.id),
  }));

  return [...attach, ...automation, ...runtimeControls];
};

/** Capability glyph tinted with the provider color so Claude vs Codex stay distinct. */
const controlMenuIcon = (
  provider: (typeof CONTROL_COMMANDS)[number]["provider"],
  capability: (typeof CONTROL_COMMANDS)[number]["capability"],
): ReactNode =>
  createElement(
    "span",
    {
      style: {
        color: getRuntimeUi(provider).color,
        display: "inline-flex",
        alignItems: "center",
      },
      "aria-hidden": true,
    },
    menuIcon(ICONS[capability]),
  );

const workerItems = (args: MenuItemBuilders): MenuListItem[] =>
  (args.workers ?? []).map((worker) => ({
    id: worker.id,
    label: worker.name,
    check: args.active?.defaultWorkerId === worker.id,
    onSelect: () => args.onWorker?.(worker.id),
  }));

const workflowItems = (args: MenuItemBuilders): MenuListItem[] =>
  (args.workflows ?? []).map((workflow) => ({
    id: workflow,
    label: workflow,
    check: args.active?.defaultWorkflowId === workflow,
    onSelect: () => args.onWorkflow?.(workflow),
  }));

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
