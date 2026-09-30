import {
  formatWorkflowRuntimeModelLabel,
  getWorkflowModelOptions,
  getWorkflowThinkingLabel,
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
  { cmd: "/skill", args: "<name>", desc: "Run a runtime skill" },
  { cmd: "/clear", args: "", desc: "Settle session and open a fresh one" },
  { cmd: "/goal", args: "", desc: "Run the CLI GOAL command" },
] as const;

export type MessageSegment = { kind: "text"; text: string } | { kind: "command"; text: string };

/** Parse user message text into display segments for slash-command chips. */
export const parseMessageSegments = (text: string): MessageSegment[] => {
  const commandPattern = CHAT_COMMANDS.map(({ cmd }) => cmd.replace("/", "\\/"))
    .toSorted((left, right) => right.length - left.length)
    .join("|");
  const re = new RegExp(`(?:${commandPattern})(?=$|\\s)`, "gi");
  const segs: MessageSegment[] = [];
  let last = 0;
  let match = re.exec(text);
  while (match) {
    if (match.index > last) {
      segs.push({ kind: "text", text: text.slice(last, match.index) });
    }
    const token = match[0];
    segs.push({ kind: "command", text: token });
    last = match.index + token.length;
    match = re.exec(text);
  }
  if (last < text.length) {
    segs.push({ kind: "text", text: text.slice(last) });
  }
  return segs.length > 0 ? segs : [{ kind: "text", text }];
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
