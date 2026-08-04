import { resolve } from "node:path";
import { WORKFLOW_RUNTIME_LABELS } from "@aop/common";
import { getLogger } from "@aop/infra";
import { FREE_MAX_ACTIVE_WORKERS } from "@aop/license";

const ROOT = resolve(import.meta.dir, "..");

const PUBLISHED_FILES = [
  "README.md",
  "apps/cli/README.md",
  "docs/WORKFLOW.md",
  "docs/licensing.md",
];
const PUBLISHED_GLOBS = [
  "docs/*.md",
  "docs/architecture/*.md",
  "docs/demo/*.md",
  "apps/dashboard/README.md",
  "apps/local-server/README.md",
  "packages/*/README.md",
];

interface ForbiddenRule {
  pattern: RegExp;
  reason: string;
  allowLine?: RegExp;
}

// Patterns that previously drifted into published docs; allowLine permits the
// intentional legacy-migration notes.
const FORBIDDEN_RULES: ForbiddenRule[] = [
  { pattern: /GET-\d+/, reason: "internal Linear ticket id" },
  { pattern: /\bdefault_workflow\b/, reason: "global default_workflow setting does not exist" },
  { pattern: /cursor-cli/, reason: "cursor-cli is not a registered runtime" },
  { pattern: /\bomp\b/, reason: "omp is not a registered runtime" },
  {
    pattern: /aop-default(?!-gpt|-claude)/,
    reason: "bare aop-default is not a workflow name",
  },
  {
    pattern: /Add( menu)? → (\*\*)?New task/,
    reason: "task creation is the Backlog lane Create post-it button",
  },
  {
    pattern: /Click \*\*Mark Ready\*\*/,
    reason: "UI action is drag to In Progress or Continue in task detail",
  },
  { pattern: /\b3847\b/, reason: "legacy port", allowLine: /obsolete/i },
  { pattern: /\bAOP_URL\b/, reason: "legacy env var", allowLine: /obsolete/i },
];

export interface Violation {
  file: string;
  line: number;
  message: string;
}

export const checkForbiddenPatterns = (file: string, content: string): Violation[] => {
  const violations: Violation[] = [];
  const lines = content.split("\n");
  for (const rule of FORBIDDEN_RULES) {
    lines.forEach((line, index) => {
      if (!rule.pattern.test(line)) return;
      if (rule.allowLine?.test(line)) return;
      violations.push({
        file,
        line: index + 1,
        message: `forbidden pattern ${rule.pattern} (${rule.reason})`,
      });
    });
  }
  return violations;
};

const checkFacts = (docs: Map<string, string>): Violation[] => {
  const violations: Violation[] = [];
  const fact = (file: string, ok: boolean, message: string) => {
    if (!ok) violations.push({ file, line: 0, message });
  };

  const workflowDoc = docs.get("docs/WORKFLOW.md") ?? "";
  const readme = docs.get("README.md") ?? "";
  const cliDoc = docs.get("apps/cli/README.md") ?? "";
  const archDoc = docs.get("docs/architecture/README.md") ?? "";

  for (const runtime of Object.keys(WORKFLOW_RUNTIME_LABELS)) {
    fact(
      "docs/WORKFLOW.md",
      workflowDoc.includes(`\`${runtime}\``),
      `missing workflow runtime \`${runtime}\` from the registered provider set`,
    );
  }

  fact(
    "README.md",
    readme.includes(`${FREE_MAX_ACTIVE_WORKERS} on the free tier`),
    `free-tier worker limit is ${FREE_MAX_ACTIVE_WORKERS}; README must say "${FREE_MAX_ACTIVE_WORKERS} on the free tier"`,
  );

  fact("apps/cli/README.md", cliDoc.includes("25150"), "CLI doc must state the default port 25150");
  fact(
    "README.md",
    readme.includes("aop.localhost:25150"),
    "README must state the dashboard URL aop.localhost:25150",
  );

  for (const [file, doc] of [
    ["docs/architecture/README.md", archDoc],
    ["docs/WORKFLOW.md", workflowDoc],
  ] as const) {
    fact(
      file,
      doc.includes("~/.aop/repos/"),
      "must document canonical task storage under ~/.aop/repos/",
    );
    fact(file, doc.includes("aop.sqlite"), "must document the aop.sqlite metadata store");
  }
  fact(
    "docs/architecture/README.md",
    archDoc.includes("~/.aop/worktrees/"),
    "must document worktree storage under ~/.aop/worktrees/",
  );

  return violations;
};

const collectPublishedFiles = (): string[] => {
  const files = [...PUBLISHED_FILES];
  for (const pattern of PUBLISHED_GLOBS) {
    for (const match of new Bun.Glob(pattern).scanSync(ROOT)) files.push(match);
  }
  return files.sort();
};

export const runDocsCheck = async (): Promise<Violation[]> => {
  const docs = new Map<string, string>();
  for (const file of collectPublishedFiles()) {
    docs.set(file, await Bun.file(resolve(ROOT, file)).text());
  }

  const violations: Violation[] = [];
  for (const [file, content] of docs) violations.push(...checkForbiddenPatterns(file, content));
  violations.push(...checkFacts(docs));
  return violations;
};

if (import.meta.main) {
  const logger = getLogger("scripts", "docs-check");
  const violations = await runDocsCheck();
  if (violations.length === 0) {
    logger.info("docs:check passed — published docs match code facts");
    process.exit(0);
  }
  for (const v of violations) {
    logger.error("{location} — {message}", {
      location: v.line ? `${v.file}:${v.line}` : v.file,
      message: v.message,
    });
  }
  logger.error("docs:check failed with {count} violation(s)", { count: violations.length });
  process.exit(1);
}
