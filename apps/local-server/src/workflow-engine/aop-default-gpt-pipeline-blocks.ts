import { AOP_DEFAULT_IMPLEMENT_STEP_ID } from "./aop-default-gpt-migrations.ts";
import type { StepBlockDefinition } from "./step-library.ts";

/** Step blocks used by the built-in `aop-default-gpt` workflow (also composable from the palette). */
export const AOP_DEFAULT_PIPELINE_BLOCKS: StepBlockDefinition[] = [
  {
    id: AOP_DEFAULT_IMPLEMENT_STEP_ID,
    type: "implement",
    category: "general",
    description: "Implement the plan in one normal workflow step",
    signals: [],
    promptTemplate: "implement.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "run-tests",
    type: "test",
    category: "general",
    description: "Run project tests and required local verification",
    signals: [
      { name: "TESTS_PASS", description: "required local verification passed" },
      { name: "TESTS_FAIL", description: "required local verification failed" },
    ],
    promptTemplate: "run-tests.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "debug-failures",
    type: "debug",
    category: "general",
    description: "Debug failing tests and verify fixes locally before re-running tests",
    signals: [{ name: "FIX_COMPLETE", description: "root cause fixed and verified locally" }],
    promptTemplate: "debug-systematic.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "simplification",
    type: "review",
    category: "general",
    description: "Simplification and cleanup pass before the final review",
    signals: [
      {
        name: "CLEANUP_COMPLETE",
        description: "cleanup and simplification pass completed",
      },
    ],
    promptTemplate: "simplification.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "improve-architecture",
    type: "review",
    category: "general",
    description: "High-confidence architecture improvements before full review",
    signals: [
      {
        name: "ARCHITECTURE_IMPROVED",
        description: "architecture improvement pass completed",
      },
    ],
    promptTemplate: "improve-codebase-architecture.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "nuclear_review",
    type: "review",
    category: "general",
    description: "Thermo-nuclear structural review: harsh maintainability and complexity bar",
    signals: [
      { name: "REVIEW_PASSED", description: "code is clean and ready" },
      {
        name: "REVIEW_FAILED",
        description: "found issues that need the implementer to address",
      },
    ],
    promptTemplate: "nuclear-review.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "fix-issues",
    type: "implement",
    category: "general",
    description: "Address issues found during review",
    signals: [{ name: "FIX_COMPLETE", description: "all review issues have been addressed" }],
    promptTemplate: "fix-issues.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "quick-review",
    type: "review",
    category: "general",
    description: "Quick verification pass after fixes (bounded retry loop)",
    signals: [
      { name: "REVIEW_PASSED", description: "fixes verified, all checks pass" },
      { name: "REVIEW_FAILED", description: "issues remain or new issues found" },
    ],
    promptTemplate: "quick-review.md.hbs",
    defaults: { maxAttempts: 1 },
  },
];
