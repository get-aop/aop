import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { TaskStatus } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type {
  NewSignal,
  Signal,
  SignalConfidence,
  SignalKind,
  SignalProvenance,
  Task,
} from "../db/schema.ts";
import { serializeFrontmatter } from "../task-docs/frontmatter.ts";
import { getCanonicalTaskDir, toLegacyTaskChangePath } from "../task-docs/paths.ts";
import type { TaskDocFrontmatter } from "../task-docs/types.ts";

export interface CreateSignalInput {
  repoId: string;
  sourceTaskId?: string | null;
  sourceExecutionId?: string | null;
  kind: SignalKind;
  title: string;
  body: string;
  provenance: SignalProvenance;
  confidence: SignalConfidence;
}

export interface CreateSignalsFromAgentOutputInput {
  repoId: string;
  sourceTaskId: string;
  sourceExecutionId: string;
  output: string;
}

export interface ListSignalsFilters {
  repoId?: string;
  openOnly?: boolean;
}

export interface SignalDto {
  id: string;
  repoId: string;
  sourceTaskId: string | null;
  sourceExecutionId: string | null;
  kind: SignalKind;
  title: string;
  body: string;
  provenance: SignalProvenance;
  confidence: SignalConfidence;
  consumedAt: string | null;
  consumedTaskId: string | null;
  createdAt: string;
}

export type ConsumeSignalResult =
  | { success: true; signal: SignalDto; task: Task }
  | { success: false; error: { code: "NOT_FOUND" | "ALREADY_CONSUMED" | "REPO_NOT_FOUND" } };

export const createSignal = async (
  ctx: LocalServerContext,
  input: CreateSignalInput,
): Promise<SignalDto> => {
  const now = new Date().toISOString();
  const signal: NewSignal = {
    id: `signal_${randomUUID()}`,
    repo_id: input.repoId,
    source_task_id: input.sourceTaskId ?? null,
    source_execution_id: input.sourceExecutionId ?? null,
    kind: input.kind,
    title: input.title.trim(),
    body: input.body.trim(),
    provenance: input.provenance,
    confidence: input.confidence,
    consumed_at: null,
    consumed_task_id: null,
    created_at: now,
  };

  await ctx.db.insertInto("signals").values(signal).execute();
  return toSignalDto(signal as Signal);
};

export const createSignalsFromAgentOutput = async (
  ctx: LocalServerContext,
  input: CreateSignalsFromAgentOutputInput,
): Promise<SignalDto[]> => {
  const signals = parseAgentSignalBlocks(input.output);
  const created: SignalDto[] = [];

  for (const signal of signals) {
    created.push(
      await createSignal(ctx, {
        repoId: input.repoId,
        sourceTaskId: input.sourceTaskId,
        sourceExecutionId: input.sourceExecutionId,
        kind: signal.kind,
        title: signal.title,
        body: signal.body,
        provenance: "aop",
        confidence: signal.confidence,
      }),
    );
  }

  return created;
};

export const listSignals = async (
  ctx: LocalServerContext,
  filters: ListSignalsFilters = {},
): Promise<SignalDto[]> => {
  let query = ctx.db.selectFrom("signals").selectAll();
  if (filters.repoId) query = query.where("repo_id", "=", filters.repoId);
  if (filters.openOnly) query = query.where("consumed_at", "is", null);

  const rows = await query.orderBy("created_at", "desc").execute();
  return rows.map(toSignalDto);
};

export const consumeSignalAsDraftTask = async (
  ctx: LocalServerContext,
  signalId: string,
): Promise<ConsumeSignalResult> => {
  const signal = await getSignal(ctx, signalId);
  if (!signal) return { success: false, error: { code: "NOT_FOUND" } };
  if (signal.consumed_at) return { success: false, error: { code: "ALREADY_CONSUMED" } };

  const repo = await ctx.repoRepository.getById(signal.repo_id);
  if (!repo) return { success: false, error: { code: "REPO_NOT_FOUND" } };

  const now = new Date().toISOString();
  const taskId = `task_${signal.id.replace(/^signal_/, "")}`;
  const changePath = toLegacyTaskChangePath(buildSignalTaskSlug(signal.title, signal.id));
  const taskDir = getCanonicalTaskDir(signal.repo_id, changePath);

  await mkdir(taskDir, { recursive: true });
  await writeSignalTaskFile(taskDir, {
    id: taskId,
    title: signal.title,
    body: signal.body,
    changePath,
    createdAt: now,
  });

  const task = await ctx.taskRepository.createIdempotentRecordOnly({
    id: taskId,
    repo_id: signal.repo_id,
    change_path: changePath,
    worktree_path: null,
    status: TaskStatus.DRAFT,
    ready_at: null,
    preferred_workflow: null,
    base_branch: null,
    preferred_provider: null,
    retry_from_step: null,
    resume_input: null,
    archived_at: null,
    handoff_pending_approval: false,
    handoff_requires_approval_override: null,
    created_at: now,
    updated_at: now,
  });

  if (!task) return { success: false, error: { code: "ALREADY_CONSUMED" } };

  await ctx.db
    .updateTable("signals")
    .set({ consumed_at: now, consumed_task_id: task.id })
    .where("id", "=", signal.id)
    .where("consumed_at", "is", null)
    .execute();

  return {
    success: true,
    signal: { ...toSignalDto(signal), consumedAt: now, consumedTaskId: task.id },
    task,
  };
};

const getSignal = async (ctx: LocalServerContext, signalId: string): Promise<Signal | null> =>
  (await ctx.db.selectFrom("signals").selectAll().where("id", "=", signalId).executeTakeFirst()) ??
  null;

const writeSignalTaskFile = async (
  taskDir: string,
  task: { id: string; title: string; body: string; changePath: string; createdAt: string },
): Promise<void> => {
  const frontmatter: TaskDocFrontmatter = {
    id: task.id,
    title: task.title,
    status: TaskStatus.DRAFT,
    created: task.createdAt,
    changePath: task.changePath,
  };
  const body = [
    "",
    "## Description",
    task.body,
    "",
    "## Requirements",
    "",
    "## Acceptance Criteria",
    "- [ ] Review this generated follow-up before marking ready",
    "",
  ].join("\n");

  await Bun.write(join(taskDir, "task.md"), serializeFrontmatter({ frontmatter, content: body }));
};

const buildSignalTaskSlug = (title: string, signalId: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "signal"}-${basename(signalId)}`;
};

const SIGNAL_BLOCK_REGEX = /<aop-signal\b([^>]*)>([\s\S]*?)<\/aop-signal>/gi;
const SIGNAL_KINDS = new Set<SignalKind>([
  "follow-up",
  "regression",
  "dependency",
  "flaky-test",
  "docs-gap",
]);
const SIGNAL_CONFIDENCES = new Set<SignalConfidence>(["low", "medium", "high"]);

const parseAgentSignalBlocks = (
  output: string,
): Array<{ kind: SignalKind; title: string; body: string; confidence: SignalConfidence }> => {
  const signals: Array<{
    kind: SignalKind;
    title: string;
    body: string;
    confidence: SignalConfidence;
  }> = [];

  for (const match of output.matchAll(SIGNAL_BLOCK_REGEX)) {
    const attributes = parseSignalAttributes(match[1] ?? "");
    const kind = parseSignalKind(attributes.kind);
    const confidence = parseSignalConfidence(attributes.confidence);
    const title = attributes.title?.trim();
    const body = (match[2] ?? "").trim();

    if (!kind || !confidence || !title || body.length === 0) continue;
    signals.push({ kind, title, body, confidence });
  }

  return signals;
};

const parseSignalAttributes = (raw: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)) {
    attributes[match[1] ?? ""] = match[2] ?? "";
  }
  return attributes;
};

const parseSignalKind = (value: string | undefined): SignalKind | null =>
  SIGNAL_KINDS.has(value as SignalKind) ? (value as SignalKind) : null;

const parseSignalConfidence = (value: string | undefined): SignalConfidence | null => {
  const confidence = value ?? "medium";
  return SIGNAL_CONFIDENCES.has(confidence as SignalConfidence)
    ? (confidence as SignalConfidence)
    : null;
};

const toSignalDto = (signal: Signal): SignalDto => ({
  id: signal.id,
  repoId: signal.repo_id,
  sourceTaskId: signal.source_task_id,
  sourceExecutionId: signal.source_execution_id,
  kind: signal.kind,
  title: signal.title,
  body: signal.body,
  provenance: signal.provenance,
  confidence: signal.confidence,
  consumedAt: signal.consumed_at,
  consumedTaskId: signal.consumed_task_id,
  createdAt: signal.created_at,
});
