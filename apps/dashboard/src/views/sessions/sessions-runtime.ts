import {
  CONTROL_COMMANDS,
  controlCommandLabel,
  formatWorkflowRuntimeModelLabel,
  getWorkflowModelOptions,
  getWorkflowThinkingLabel,
  parseControlCommand,
  parseRuntimeDelegation,
  RUNTIME_DELEGATIONS,
  WORKFLOW_RUNTIME_LABELS,
  WORKFLOW_THINKING_OPTIONS,
  type WorkflowRuntimeProvider,
} from "@aop/common";

export interface RuntimeUiMeta {
  key: WorkflowRuntimeProvider;
  label: string;
  cmd: string;
  glyph: string;
  color: string;
}

export const RUNTIME_UI: Record<WorkflowRuntimeProvider, RuntimeUiMeta> = {
  "claude-code": {
    key: "claude-code",
    label: WORKFLOW_RUNTIME_LABELS["claude-code"],
    cmd: "claude",
    glyph: "CL",
    color: "var(--color-favorite)",
  },
  "codex-cli": {
    key: "codex-cli",
    label: WORKFLOW_RUNTIME_LABELS["codex-cli"],
    cmd: "codex",
    glyph: "CX",
    color: "var(--color-running)",
  },
  "grok-build": {
    key: "grok-build",
    label: WORKFLOW_RUNTIME_LABELS["grok-build"],
    cmd: "grok",
    glyph: "GX",
    color: "var(--color-queued)",
  },
  opencode: {
    key: "opencode",
    label: WORKFLOW_RUNTIME_LABELS.opencode,
    cmd: "opencode",
    glyph: "OC",
    color: "var(--color-blocked)",
  },
  pi: {
    key: "pi",
    label: WORKFLOW_RUNTIME_LABELS.pi,
    cmd: "pi",
    glyph: "PI",
    color: "var(--color-ok)",
  },
};

export const RUNTIME_LIST = Object.values(RUNTIME_UI);

export const getRuntimeUi = (runtime: string): RuntimeUiMeta =>
  RUNTIME_UI[runtime as WorkflowRuntimeProvider] ?? RUNTIME_UI["claude-code"];

export const getEffectiveCmd = (runtime: string, alias: string | null | undefined): string =>
  alias?.trim() || getRuntimeUi(runtime).cmd;

export const getModelLabel = (model: string): string => formatWorkflowRuntimeModelLabel(model);

export const getEffortLabel = (runtime: string, effort: string, model = ""): string =>
  getWorkflowThinkingLabel(
    runtime as WorkflowRuntimeProvider,
    effort as Parameters<typeof getWorkflowThinkingLabel>[1],
    model,
  );

export const modelOptionsFor = (runtime: string): readonly string[] =>
  getWorkflowModelOptions(runtime as WorkflowRuntimeProvider);

export const EFFORT_OPTIONS = WORKFLOW_THINKING_OPTIONS;

export const CHAT_COMMANDS = [
  { cmd: "/implement", args: "<runtime>", desc: "Choose the runtime that implements the request" },
  { cmd: "/review", args: "<runtime>", desc: "Review the implementation after it completes" },
  { cmd: "/audit", args: "<runtime>", desc: "Audit the implementation after it completes" },
  { cmd: "/test", args: "<runtime>", desc: "Run tests after the implementation completes" },
  { cmd: "/security", args: "<runtime>", desc: "Run a security review after implementation" },
  { cmd: "/workflow", args: "run <name>", desc: "Trigger a workflow" },
  { cmd: "/skill", args: "<name>", desc: "Run a runtime skill" },
  { cmd: "/clear", args: "", desc: "Settle session and open a fresh one" },
  { cmd: "/goal", args: "", desc: "Run the CLI GOAL command" },
] as const;

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "command"; text: string }
  | { kind: "mention"; text: string };

/** Parse user message text into display segments for command/mention chips. */
export const parseMessageSegments = (
  text: string,
  workerNames: string[] = [],
): MessageSegment[] => {
  const mentionPattern =
    workerNames.length > 0
      ? workerNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
      : "\\w+";
  const commandPattern = CHAT_COMMANDS.map(({ cmd }) => cmd.replace("/", "\\/"))
    .toSorted((left, right) => right.length - left.length)
    .join("|");
  const re = new RegExp(`((?:${commandPattern})(?=$|\\s)|%(?:${mentionPattern}))`, "gi");
  const segs: MessageSegment[] = [];
  let last = 0;
  let match = re.exec(text);
  while (match) {
    if (match.index > last) {
      segs.push({ kind: "text", text: text.slice(last, match.index) });
    }
    const token = match[0];
    segs.push({ kind: classifyMessageToken(token), text: token });
    last = match.index + token.length;
    match = re.exec(text);
  }
  if (last < text.length) {
    segs.push({ kind: "text", text: text.slice(last) });
  }
  return segs.length > 0 ? segs : [{ kind: "text", text }];
};

const classifyMessageToken = (token: string): MessageSegment["kind"] => {
  if (token.startsWith("/")) return "command";
  if (token.startsWith("%")) return "mention";
  return "text";
};

export type HistoryActionBadge = {
  kind: "delegation" | "control";
  label: string;
};

/**
 * Strip transport markers from stored/optimistic user content and derive
 * yellow history badges only when a real delegation/control was used.
 */
export const resolveUserMessageDisplay = (
  content: string,
): { displayText: string; badges: HistoryActionBadge[] } => {
  const badges: HistoryActionBadge[] = [];
  let displayText = content;

  const delegationBadge = badgeFromDelegationMarker(content);
  if (delegationBadge) {
    badges.push(delegationBadge.badge);
    displayText = delegationBadge.displayText;
  }

  const controlBadge = badgeFromControlMarker(displayText);
  if (controlBadge) {
    badges.push(controlBadge.badge);
    displayText = controlBadge.displayText;
  }

  return { displayText, badges };
};

const badgeFromDelegationMarker = (
  content: string,
): { badge: HistoryActionBadge; displayText: string } | null => {
  const delegation = parseRuntimeDelegation(content);
  if (!delegation || "error" in delegation) return null;
  const runtimeLabel =
    RUNTIME_DELEGATIONS.find((item) => item.id === delegation.id)?.label ?? delegation.label;
  return {
    badge: {
      kind: "delegation",
      label: `Delegated to ‘${runtimeLabel}’ using ${formatBadgeSelection(
        delegation.model,
        delegation.reasoning,
        delegation.fastMode,
      )}`,
    },
    displayText: delegation.prompt,
  };
};

const badgeFromControlMarker = (
  content: string,
): { badge: HistoryActionBadge; displayText: string } | null => {
  const control = parseControlCommand(content);
  if (!control || "error" in control) return null;
  const command = CONTROL_COMMANDS.find(
    (item) =>
      item.provider === control.command.provider && item.capability === control.command.capability,
  );
  const label = command ? controlCommandLabel(command) : "control";
  return {
    badge: {
      kind: "control",
      label: `Used ${label} with ${formatBadgeSelection(
        control.command.model,
        control.command.reasoning,
        control.command.fastMode,
      )}`,
    },
    displayText: control.prompt,
  };
};

const formatBadgeSelection = (
  model: string | undefined,
  reasoning: string | undefined,
  fastMode: boolean | undefined,
): string => {
  const modelLabel = model ? formatWorkflowRuntimeModelLabel(model) : "default model";
  const reasoningLabel = reasoning ?? "default thinking";
  const fast = fastMode ? " · fast mode" : "";
  return `${modelLabel} · ${reasoningLabel}${fast}`;
};

export const formatRelativeTime = (iso: string, now = Date.now()): string => {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

export const ACTION_COLORS: Record<string, string> = {
  task: "var(--color-running)",
  pool: "var(--color-running)",
  workflows: "var(--color-queued)",
  review: "var(--color-blocked)",
  workerNew: "var(--color-favorite)",
  session: "var(--color-ok)",
};

export interface SlashTokenMatch {
  start: number;
  end: number;
  query: string;
}

/**
 * Slash token at the caret when it starts the draft or follows whitespace.
 * Paths like `/tmp/foo` and mid-word `foo/bar` are not eligible.
 */
export const matchSlashToken = (draft: string, caret = draft.length): SlashTokenMatch | null => {
  const before = draft.slice(0, caret);
  // Allow spaces so commands still filter while typing a trailing space.
  // Bare `/` is eligible (.* not .+) so the full command menu can open.
  const tokenMatch = before.match(/(?:^|\s)(\/.*)$/);
  if (!tokenMatch) return null;
  const token = tokenMatch[1] ?? "";
  const start = before.length - token.length;
  // Reject path-like continuations that already contain a second slash after the lead.
  if (token.indexOf("/", 1) !== -1) return null;
  return { start, end: caret, query: token.toLowerCase() };
};

export const filterSlashCommands = (input: string, caret = input.length) => {
  const token = matchSlashToken(input, caret);
  if (!token) return [];
  return CHAT_COMMANDS.filter((command) => command.cmd.startsWith(token.query));
};

/**
 * Leading exact deterministic commands execute on send (Enter), not as completion picks.
 * Completion still works for partial prefixes (`/st`) and embedded mid-draft tokens.
 */
export const isExactLeadingSlashCommand = (input: string, caret = input.length): boolean => {
  const token = matchSlashToken(input, caret);
  if (token?.start !== 0) return false;
  const tokenText = input.slice(0, token.end);
  return CHAT_COMMANDS.some((command) => command.cmd === tokenText);
};

export const applySlashCommandInsert = (
  draft: string,
  token: SlashTokenMatch,
  command: string,
): { draft: string; caret: number } => {
  const insert = command.endsWith(" ") ? command : `${command} `;
  const next = `${draft.slice(0, token.start)}${insert}${draft.slice(token.end)}`;
  return { draft: next, caret: token.start + insert.length };
};
