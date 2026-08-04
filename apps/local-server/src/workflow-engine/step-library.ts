import type { SignalDefinition } from "@aop/common/protocol";
import { AOP_DEFAULT_PIPELINE_BLOCKS } from "./aop-default-gpt-pipeline-blocks.ts";
import type { StepAgent, StepType } from "./types.ts";

export interface StepBlockDefinition {
  id: string;
  type: StepType;
  category: "general" | "backend" | "frontend" | "business" | "research";
  description: string;
  signals: SignalDefinition[];
  promptTemplate: string;
  promptContent?: string;
  defaults: { maxAttempts: number };
  agent?: StepAgent;
  source?: "builtin" | "user" | "local";
}

export const STEP_LIBRARY: StepBlockDefinition[] = [
  {
    id: "codebase_research",
    type: "research",
    category: "general",
    description: "Explore codebase using Grep/Glob/Read to identify patterns and conventions",
    signals: [
      {
        name: "RESEARCH_COMPLETE",
        description: "codebase exploration is done, findings are written",
      },
    ],
    promptTemplate: "codebase-research.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "visual_verify",
    type: "review",
    category: "frontend",
    description: "Take screenshots, present visual state for human verification",
    signals: [
      { name: "LOOKS_GOOD", description: "visual implementation matches expectations" },
      { name: "NEEDS_CHANGES", description: "identified visual issues that need fixing" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need human judgment on the visual result. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "visual-verify.md.hbs",
    defaults: { maxAttempts: 5 },
  },
  {
    id: "seo_audit",
    type: "review",
    category: "frontend",
    description: "Run lighthouse/SEO checks and report results",
    signals: [
      { name: "SEO_PASS", description: "SEO checks meet acceptable thresholds" },
      { name: "SEO_NEEDS_WORK", description: "issues found that need addressing" },
    ],
    promptTemplate: "seo-audit.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "code_review",
    type: "review",
    category: "general",
    description: "Review code changes for quality, remove AI slop",
    signals: [
      { name: "REVIEW_PASSED", description: "code is clean and ready" },
      { name: "REVIEW_FAILED", description: "found issues that need the implementer to address" },
    ],
    promptTemplate: "code-review-step.md.hbs",
    defaults: { maxAttempts: 2 },
  },
  {
    id: "audit",
    type: "review",
    category: "general",
    description:
      "Read-only correctness and maintainability audit of the resulting repository state",
    signals: [
      { name: "AUDIT_PASSED", description: "no material audit findings" },
      { name: "AUDIT_FAILED", description: "material audit findings were reported" },
    ],
    promptTemplate: "audit.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "security-review",
    type: "review",
    category: "general",
    description: "Read-only security review of the resulting repository state",
    signals: [
      { name: "SECURITY_PASSED", description: "no material security findings" },
      { name: "SECURITY_FAILED", description: "material security findings were reported" },
    ],
    promptTemplate: "security-review.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "market_analysis",
    type: "research",
    category: "frontend",
    description:
      "Research competitors, audience, positioning, and conversion patterns for landing page design",
    signals: [
      { name: "RESEARCH_COMPLETE", description: "market research is done, findings are written" },
    ],
    promptTemplate: "market-analysis.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "design_brief",
    type: "iterate",
    category: "frontend",
    description:
      "Ingest moodboard, brand assets, and style references to produce design tokens and visual direction",
    signals: [
      { name: "BRIEF_READY", description: "design brief with tokens is written and ready" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need visual references or brand direction. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "design-brief.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "outline_page",
    type: "iterate",
    category: "frontend",
    description:
      "Create section-by-section landing page outline with CTA strategy and conversion flow",
    signals: [
      {
        name: "PLAN_READY",
        description: "outline is written to plan.md, ready for human approval",
      },
      { name: "PLAN_APPROVED", description: "human approved the outline, proceed to copy" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need clarification on page structure or goals. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "outline-landing-page.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "write_copy",
    type: "iterate",
    category: "frontend",
    description: "Write CRO-optimized copy for all landing page sections",
    signals: [
      { name: "CONTENT_READY", description: "copy is written and CRO-reviewed" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need clarification on messaging or tone. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "landing-page-copy.md.hbs",
    defaults: { maxAttempts: 5 },
  },
  {
    id: "implement_page",
    type: "implement",
    category: "frontend",
    description: "Implement a landing page from the approved outline, copy, and design brief",
    signals: [],
    promptTemplate: "implement-frontend.md.hbs",
    defaults: { maxAttempts: 15 },
  },
  {
    id: "add_differentiator",
    type: "implement",
    category: "frontend",
    description: "Design and build a unique interactive widget that differentiates the product",
    signals: [],
    promptTemplate: "add-differentiator.md.hbs",
    defaults: { maxAttempts: 10 },
  },
  {
    id: "browser_control",
    type: "implement",
    category: "general",
    description:
      "Drive an isolated browser session (navigate, click, extract) via a compatible runtime",
    signals: [
      {
        name: "BROWSER_TASK_COMPLETE",
        description: "browser control work finished with findings or actions recorded",
      },
      {
        name: "BROWSER_TASK_FAILED",
        description: "browser control could not complete the requested work",
      },
    ],
    promptTemplate: "browser-control.md.hbs",
    defaults: { maxAttempts: 3 },
    agent: {
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
      browserControl: true,
      computerControl: false,
    },
  },
  {
    id: "computer_control",
    type: "implement",
    category: "general",
    description:
      "Control the local computer desktop (mouse, keyboard, screenshots) via Codex CLI only",
    signals: [
      {
        name: "COMPUTER_TASK_COMPLETE",
        description: "computer control work finished with findings or actions recorded",
      },
      {
        name: "COMPUTER_TASK_FAILED",
        description: "computer control could not complete the requested work",
      },
    ],
    promptTemplate: "computer-control.md.hbs",
    defaults: { maxAttempts: 3 },
    agent: {
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
      browserControl: false,
      computerControl: true,
    },
  },
  ...AOP_DEFAULT_PIPELINE_BLOCKS,
];

export const STEP_LIBRARY_MAP = new Map(STEP_LIBRARY.map((block) => [block.id, block]));

export const getStepBlock = (id: string): StepBlockDefinition | undefined =>
  STEP_LIBRARY_MAP.get(id);
