import {
  type ChatWorkflowSelection,
  CONTROL_COMMANDS,
  controlCommandLabel,
  RUNTIME_DELEGATIONS,
  type RuntimeConfigurationProvider,
  type RuntimeDelegationId,
  runtimeConfigurationToDelegationId,
} from "@aop/common";
import { isRunnableRuntimeConfiguration } from "../../runtime-configuration-selection";

export interface RuntimeDelegationCandidate {
  id: RuntimeDelegationId;
  label: string;
  text: string;
  start: number;
  end: number;
  runtimeConfigurationId?: string;
}

export const findAllRuntimeDelegationCandidates = (
  _draft: string,
  _configurations?: RuntimeConfigurationProvider[],
): RuntimeDelegationCandidate[] => [];

export const findRuntimeDelegationCandidate = (
  _draft: string,
  _caret?: number,
  _configurations?: RuntimeConfigurationProvider[],
): RuntimeDelegationCandidate | null => null;

export type TypeaheadKind = "worker" | "workflow" | "repo" | "control" | "runtime";

export interface WorkflowTypeaheadOption {
  id: string;
  name: string;
  stepCount: number;
  stepTypes?: string[];
  steps?: ChatWorkflowSelection["steps"];
}

export interface TypeaheadItem {
  id: string;
  label: string;
  kind: TypeaheadKind;
  insertText: string;
  /** When set, selecting this item arms one-turn runtime delegation. */
  runtimeId?: RuntimeDelegationId;
  /** Bound settings runtime configuration for the armed delegation. */
  runtimeConfigurationId?: string;
  workflow?: WorkflowTypeaheadOption;
}

export interface TypeaheadMatch {
  items: TypeaheadItem[];
  /** Start index in the draft of the token being completed. */
  tokenStart: number;
  query: string;
  kind: TypeaheadKind;
}

/**
 * Linear/Slack-style typeahead: %workers, #workflows, ~repos, $control, @runtime.
 * Pure helper so unit tests can drive matching without a browser.
 */
export const matchTypeahead = (input: {
  draft: string;
  caret: number;
  workers: Array<{ id: string; name: string }>;
  workflows: Array<string | WorkflowTypeaheadOption>;
  repos: Array<{ id: string; name: string | null; path: string }>;
  runtimeConfigurations?: RuntimeConfigurationProvider[];
}): TypeaheadMatch | null => {
  const { draft, caret } = input;
  const before = draft.slice(0, caret);
  const tokenMatch = before.match(/(?:^|\s)([@#~$%])([^\s]*)$/);
  if (!tokenMatch) return null;

  const trigger = tokenMatch[1] as "@" | "#" | "~" | "$" | "%";
  const query = (tokenMatch[2] ?? "").toLowerCase();
  const tokenStart = before.length - (tokenMatch[2]?.length ?? 0) - 1;

  if (trigger === "%") return matchWorkers(input.workers, query, tokenStart);
  if (trigger === "#") return matchWorkflows(input.workflows, query, tokenStart);
  if (trigger === "~") return matchRepos(input.repos, query, tokenStart);
  if (trigger === "@") return matchRuntimes(query, tokenStart, input.runtimeConfigurations);
  if (trigger === "$") return matchControls(query, tokenStart);
  return matchControls(query, tokenStart);
};

const matchRuntimes = (
  query: string,
  tokenStart: number,
  configurations?: RuntimeConfigurationProvider[],
): TypeaheadMatch => {
  const runnable = (configurations ?? []).filter(isRunnableRuntimeConfiguration);
  if (runnable.length > 0) {
    const items = runnable
      .map((configuration) => {
        const runtimeId = runtimeConfigurationToDelegationId(configuration);
        if (!runtimeId) return null;
        if (
          query &&
          !configuration.name.toLowerCase().includes(query) &&
          !configuration.command.toLowerCase().includes(query) &&
          !runtimeId.includes(query)
        ) {
          return null;
        }
        return {
          id: configuration.id,
          label: configuration.name,
          kind: "runtime" as const,
          // Visible friendly token only — marker is transport-only at send time.
          insertText: `${configuration.name} `,
          runtimeId,
          runtimeConfigurationId: configuration.id,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return { items, tokenStart, query, kind: "runtime" };
  }

  const items = RUNTIME_DELEGATIONS.filter((item) => {
    if (!query) return true;
    return item.label.toLowerCase().includes(query) || item.id.includes(query);
  }).map((item) => ({
    id: item.id,
    label: item.label,
    kind: "runtime" as const,
    insertText: `${item.label} `,
    runtimeId: item.id,
  }));
  return { items, tokenStart, query, kind: "runtime" };
};

const matchControls = (query: string, tokenStart: number): TypeaheadMatch => {
  const items = CONTROL_COMMANDS.filter((command) => matchesControlQuery(command, query)).map(
    (command) => ({
      id: command.id.toLowerCase(),
      label: controlCommandLabel(command),
      kind: "control" as const,
      insertText: `$${command.id} `,
    }),
  );
  return { items, tokenStart, query, kind: "control" };
};

const matchesControlQuery = (
  command: (typeof CONTROL_COMMANDS)[number],
  query: string,
): boolean => {
  if (!query) return true;
  const label = controlCommandLabel(command).toLowerCase();
  return (
    command.id.toLowerCase().includes(query) ||
    label.includes(query) ||
    command.provider.includes(query) ||
    command.capability.includes(query)
  );
};

const matchWorkers = (
  workers: Array<{ id: string; name: string }>,
  query: string,
  tokenStart: number,
): TypeaheadMatch | null => {
  const items = workers
    .filter((worker) => worker.name.toLowerCase().includes(query))
    .slice(0, 8)
    .map((worker) => ({
      id: worker.id,
      label: worker.name,
      kind: "worker" as const,
      insertText: `%${worker.name} `,
    }));
  if (isExactCompletedToken(query, items)) return null;
  return { items, tokenStart, query, kind: "worker" };
};

const matchWorkflows = (
  workflows: Array<string | WorkflowTypeaheadOption>,
  query: string,
  tokenStart: number,
): TypeaheadMatch | null => {
  const items = workflows
    .map((workflow) =>
      typeof workflow === "string" ? { id: workflow, name: workflow, stepCount: 0 } : workflow,
    )
    .filter((workflow) => workflow.name.toLowerCase().includes(query))
    .slice(0, 8)
    .map((workflow) => ({
      id: workflow.id,
      label: workflow.name,
      kind: "workflow" as const,
      insertText: "",
      workflow,
    }));
  if (isExactCompletedToken(query, items)) return null;
  return { items, tokenStart, query, kind: "workflow" };
};

const matchRepos = (
  repos: Array<{ id: string; name: string | null; path: string }>,
  query: string,
  tokenStart: number,
): TypeaheadMatch | null => {
  const items = repos
    .filter((repo) => {
      const label = (repo.name ?? repo.path).toLowerCase();
      return label.includes(query) || repo.id.toLowerCase().includes(query);
    })
    .slice(0, 8)
    .map((repo) => ({
      id: repo.id,
      label: repo.name ?? repo.path,
      kind: "repo" as const,
      insertText: `~${repo.name ?? repo.id} `,
    }));
  if (isExactCompletedToken(query, items)) return null;
  return { items, tokenStart, query, kind: "repo" };
};

export const applyTypeaheadInsert = (
  draft: string,
  tokenStart: number,
  caret: number,
  insertText: string,
): { draft: string; caret: number } => {
  const next = `${draft.slice(0, tokenStart)}${insertText}${draft.slice(caret)}`;
  const nextCaret = tokenStart + insertText.length;
  return { draft: next, caret: nextCaret };
};

/** True when the typed query already equals the only remaining item (token complete). */
const isExactCompletedToken = (
  query: string,
  items: Array<{ label: string; insertText: string }>,
): boolean => {
  if (!query || items.length !== 1) return false;
  const only = items[0];
  if (!only) return false;
  const label = only.label.toLowerCase();
  const insertCore = only.insertText
    .replace(/^[@#~$%]/, "")
    .trim()
    .toLowerCase();
  return query === label || query === insertCore;
};

export const DEFAULT_SESSION_SUGGESTIONS = [
  "Create a task from this bug report",
  "Build a workflow",
];
