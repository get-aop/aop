import { expect } from "bun:test";
import type { z } from "zod";

type Overrides = Record<string, unknown>;

export const AT = "2026-09-29T10:00:00.000Z";
export const LATER = "2026-09-29T11:30:00.000Z";

export const makeRuntimeSelection = (overrides: Overrides = {}) => ({
  provider: "claude-code",
  model: "claude-opus-5",
  effort: "high",
  ...overrides,
});

export const makePrArtifact = (overrides: Overrides = {}) => ({
  type: "pr",
  number: 4821,
  url: "https://github.com/acme/checkout-service/pull/4821",
  state: "open",
  ...overrides,
});

export const makeBlockedQuestion = (overrides: Overrides = {}) => ({
  question: "Upgrade the Lambda to Node 20, or pin stripe-node to the last working version?",
  options: [
    { label: "Upgrade the Lambda to Node 20", recommended: true },
    { label: "Pin stripe-node to 14.2.0" },
  ],
  ...overrides,
});

/** A valid `working` thread; override `status` and the fields that status requires for the rest. */
export const makeThread = (overrides: Overrides = {}) => ({
  id: "thr_1",
  projectId: "prj_1",
  title: "Fix 4s cold start regression",
  status: "working",
  runtime: makeRuntimeSelection(),
  target: { kind: "host" },
  repoId: "repo_1",
  branch: "aop/cold-start-a1b2c3",
  steps: [
    { label: "Profile the cold start", state: "done" },
    { label: "Bisect the regression", state: "active" },
    { label: "Patch and verify", state: "pending" },
  ],
  liveStatusLine: "Bisecting · 7 commits left",
  artifacts: [],
  repliesCount: 3,
  unread: false,
  lastActivityAt: AT,
  createdAt: AT,
  ...overrides,
});

export const makeProject = (overrides: Overrides = {}) => ({
  id: "prj_1",
  name: "checkout-service",
  goal: "Keep checkout fast and safe to change",
  instructions: "Never touch the payments schema without asking.",
  coordinator: { provider: "claude-code", model: null, effort: "low" },
  thread: { provider: "claude-code", model: "claude-opus-5", effort: "high" },
  notificationLevel: "coordinator",
  repoIds: ["repo_1"],
  status: "active",
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

export const makeUserMessage = (overrides: Overrides = {}) => ({
  id: "msg_1",
  projectId: "prj_1",
  threadId: null,
  role: "user",
  text: "Fix the cold start and harden checkout.",
  createdAt: AT,
  ...overrides,
});

export const makeAssistantMessage = (overrides: Overrides = {}) => ({
  id: "msg_2",
  projectId: "prj_1",
  threadId: null,
  role: "assistant",
  blocks: [{ type: "text", text: "On it. Two threads; I'll flag anything that needs you." }],
  createdAt: AT,
  ...overrides,
});

/** Parses and returns the result typed `unknown`, so it can be compared with a plain fixture. */
export const parsed = (schema: z.ZodType, input: unknown): unknown => schema.parse(input);

/** Asserts the schema rejects the input and returns the dotted path of every issue. */
export const rejectedPaths = (schema: z.ZodType, input: unknown): string[] => {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};
