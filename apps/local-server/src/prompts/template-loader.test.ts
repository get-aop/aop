import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemplateLoader, type TemplateLoader } from "./template-loader.ts";

describe("TemplateLoader", () => {
  let loader: TemplateLoader;
  const originalTemplatesDir = process.env.AOP_TEMPLATES_DIR;

  beforeEach(() => {
    process.env.AOP_TEMPLATES_DIR = originalTemplatesDir;
    loader = createTemplateLoader();
  });

  describe("load", () => {
    const templateFiles = [
      "implement.md.hbs",
      "review.md.hbs",
      "iterate.md.hbs",
      "simplification.md.hbs",
      "nuclear-review.md.hbs",
      "improve-codebase-architecture.md.hbs",
      "full-review.md.hbs",
      "quick-review.md.hbs",
      "fix-issues.md.hbs",
      "codebase-research.md.hbs",
      "implement-frontend.md.hbs",
      "visual-verify.md.hbs",
      "run-tests.md.hbs",
      "seo-audit.md.hbs",
      "code-review-step.md.hbs",
      "debug-systematic.md.hbs",
    ];

    for (const filename of templateFiles) {
      test(`loads ${filename} template with resolved partials`, async () => {
        const template = await loader.load(filename);

        expect(template).toContain("{{worktree.path}}");
        expect(template).toContain("{{worktree.branch}}");
        expect(template).toContain("{{task.docsDir}}");
        expect(template).toContain("{{task.changePath}}");
        expect(template).not.toContain("{{> task-context}}");
        expect(template).not.toContain("{{> output-signals}}");
      });
    }

    test("caches loaded templates", async () => {
      const template1 = await loader.load("implement.md.hbs");
      const template2 = await loader.load("implement.md.hbs");

      expect(template1).toBe(template2);
    });

    test("loads inline user-created workflow templates without reading a file", async () => {
      const template = await loader.load(
        "inline:Run a custom review pass for {{task.changePath}}.",
      );

      expect(template).toBe("Run a custom review pass for {{task.changePath}}.");
    });

    test("throws for unknown template file", async () => {
      await expect(loader.load("unknown.md.hbs")).rejects.toThrow("Template not found");
    });

    test("loads templates and partials from an installed asset directory", async () => {
      const templatesDir = await mkdtemp(join(tmpdir(), "aop-templates-"));
      process.env.AOP_TEMPLATES_DIR = templatesDir;
      loader = createTemplateLoader();

      try {
        await writeFile(join(templatesDir, "_installed-partial.md.hbs"), "Installed partial");
        await writeFile(
          join(templatesDir, "installed.md.hbs"),
          "Installed template\n{{> installed-partial}}",
        );

        const template = await loader.load("installed.md.hbs");

        expect(template).toBe("Installed template\nInstalled partial");
      } finally {
        await rm(templatesDir, { force: true, recursive: true });
        process.env.AOP_TEMPLATES_DIR = originalTemplatesDir;
      }
    });

    test("resolves renamed templates for workflows saved before the rename", async () => {
      const legacyCleanup = await loader.load("cleanup-review.md.hbs");
      const currentCleanup = await loader.load("simplification.md.hbs");
      const legacyReview = await loader.load("review.md.hbs");
      const currentNuclear = await loader.load("nuclear-review.md.hbs");

      expect(legacyCleanup).toBe(currentCleanup);
      expect(legacyCleanup).toContain("simplification pass");
      expect(legacyReview).toBe(currentNuclear);
      expect(legacyReview).toContain("Thermo-Nuclear Code Quality Review");
    });
  });

  describe("partial resolution", () => {
    test("expands task-context partial with all standard fields", async () => {
      const template = await loader.load("implement-frontend.md.hbs");

      expect(template).toContain("{{task.docsDir}}");
      expect(template).toContain("{{task.changePath}}");
      expect(template).toContain("{{worktree.path}}");
      expect(template).toContain("{{worktree.branch}}");
      expect(template).toContain("{{#if input}}");
    });

    test("expands output-signals partial with signal template", async () => {
      const template = await loader.load("run-tests.md.hbs");

      expect(template).toContain("{{#if signals}}");
      expect(template).toContain("{{#each signals}}");
      expect(template).toContain("{{this.name}}");
      expect(template).toContain("{{this.description}}");
      expect(template).not.toContain("{{> output-signals}}");
    });

    test("partial content is consistent across all templates", async () => {
      const implement = await loader.load("implement.md.hbs");
      const frontend = await loader.load("implement-frontend.md.hbs");

      const extractContext = (t: string) => {
        const start = t.indexOf("## Task Details");
        const end = t.indexOf("{{/if}}") + "{{/if}}".length;
        return t.slice(start, end);
      };

      expect(extractContext(implement)).toBe(extractContext(frontend));
    });

    test("task context partial includes repository scope and runtime guardrails", async () => {
      const template = await loader.load("implement-frontend.md.hbs");

      expect(template).toContain("## Repository Scope");
      expect(template).toContain("one writable primary repository per task");
      expect(template).toContain("Supporting repositories are reference-only");
      expect(template).toContain("{{#each task.repositories}}");
      expect(template).toContain("{{this.repoId}}");
      expect(template).toContain("{{this.path}}");
    });

    test("full-review template treats worktree changes as reviewable state", async () => {
      const template = await loader.load("full-review.md.hbs");

      expect(template).toContain(
        "Review the current worktree state, including staged, unstaged, and untracked changes.",
      );
      expect(template).toContain("Do not require changes to be committed to `HEAD` during review.");
      expect(template).not.toContain("git diff main...HEAD");
    });

    test("simplification template is a self-contained optional cleanup pass", async () => {
      const template = await loader.load("simplification.md.hbs");

      expect(template).toContain("narrow simplification pass");
      expect(template).toContain("Preserve exact behavior");
      expect(template).toContain("Do not spend time looking for skills");
      expect(template).toContain(
        "Do not spend time looking for skills, agents, or instructions outside the current worktree",
      );
    });

    test("review template alias resolves to the thermo-nuclear structural review", async () => {
      const template = await loader.load("review.md.hbs");
      const current = await loader.load("nuclear-review.md.hbs");

      expect(template).toBe(current);
      expect(template).toContain("# Thermo-Nuclear Code Quality Review");
      expect(template).toContain("## Rubric");
      expect(template).toContain("agent-review-report.md");
      expect(template).toContain("Enforce the 1k-line rule as a design alarm");
    });

    test("architecture template uses the repo-local architecture skill as a narrow pre-review pass", async () => {
      const template = await loader.load("improve-codebase-architecture.md.hbs");

      expect(template).toContain("# Improve Codebase Architecture");
      expect(template).toContain("Keep this pass narrow");
      expect(template).toContain("Do not create follow-up tickets");
      expect(template).toContain(
        "Leave the worktree in the best state for the final `full-review`",
      );
    });

    test("run-tests template requires CI-aligned local verification commands", async () => {
      const template = await loader.load("run-tests.md.hbs");

      expect(template).toContain("Read `.github/workflows/aop-ci.yml`");
      expect(template).toContain("bun run build");
      expect(template).toContain("bun run test:ci");
      expect(template).toContain("smallest workspace-scoped commands");
      expect(template).toContain("marker/text-only diffs");
      expect(template).toContain("npx --yes bun");
      expect(template).toContain("Do not leave commands running in the background");
      expect(template).toContain("Do not claim success unless you ran the commands you list");
    });

    test("codebase research template no longer requires ADR or glossary lookups", async () => {
      const template = await loader.load("codebase-research.md.hbs");

      expect(template).not.toContain("Read `CONTEXT.md` and ADRs before exploring");
      expect(template).not.toContain("glossary vocabulary");
      expect(template).not.toContain("ADR conflict:");
      expect(template).toContain("### 1. Read Task Context");
      expect(template).toContain("### 2. Scope the Exploration");
    });

    test("review templates require explicit verification evidence before pass signals", async () => {
      const fullReview = await loader.load("full-review.md.hbs");
      const quickReview = await loader.load("quick-review.md.hbs");

      expect(fullReview).toContain("commands run");
      expect(fullReview).toContain("Do not write `PASS` or emit `REVIEW_PASSED`");
      expect(fullReview).toContain("GitHub CI");
      expect(quickReview).toContain("Record the exact commands you ran");
      expect(quickReview).toContain("Do not emit `REVIEW_PASSED`");
    });

    test("implement template uses the reviewed task docs", async () => {
      const template = await loader.load("implement.md.hbs");

      expect(template).toContain("# Test-Driven Development");
      expect(template).toContain("`{{task.docsDir}}/plan.md`");
      expect(template).not.toContain("{{> methodology:test-driven-development}}");
      expect(template).not.toContain("CHUNK_DONE");
      expect(template).not.toContain("ALL_TASKS_DONE");
    });

    test("fix and debug templates require systematic debugging before unclear fixes", async () => {
      const fixIssues = await loader.load("fix-issues.md.hbs");
      const debugSystematic = await loader.load("debug-systematic.md.hbs");

      expect(fixIssues).toContain("# Systematic Debugging");
      expect(debugSystematic).toContain("# Systematic Debugging");
      expect(debugSystematic).toContain("root cause");
    });
  });

  describe("clearCache", () => {
    test("clears the template cache", async () => {
      await loader.load("implement.md.hbs");
      loader.clearCache();

      const template = await loader.load("implement.md.hbs");

      expect(template).toContain("{{worktree.path}}");
    });
  });
});
