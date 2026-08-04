import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

const loadE2EWorkflow = async (): Promise<Record<string, unknown>> => {
  const workflow = await readFile(".github/workflows/aop-e2e.yml", "utf8");
  return YAML.parse(workflow) as Record<string, unknown>;
};

describe("AOP E2E GitHub workflow", () => {
  test("runs the deterministic dashboard E2E lane automatically for main and PRs", async () => {
    const workflow = await loadE2EWorkflow();
    const triggers = workflow.on as Record<string, unknown>;

    expect((triggers.push as { branches?: string[] }).branches).toContain("main");
    expect((triggers.pull_request as { branches?: string[] }).branches).toContain("main");
    expect(triggers.workflow_dispatch).toBeDefined();
  });

  test("installs Chromium and runs the dashboard-only E2E command", async () => {
    const workflow = await loadE2EWorkflow();
    const jobs = workflow.jobs as Record<string, { steps?: Array<Record<string, unknown>> }>;
    const steps = jobs.e2e?.steps ?? [];
    const commands = steps.map((step) => String(step.run ?? "")).join("\n");

    expect(commands).toContain("bun e2e-tests/node_modules/.bin/playwright install chromium");
    expect(commands).not.toContain("--with-deps");
    expect(commands).toContain("bun run test:e2e:dashboard");
  });

  test("keeps failure artifacts only for the short debugging window", async () => {
    const workflow = await loadE2EWorkflow();
    const jobs = workflow.jobs as Record<string, { steps?: Array<Record<string, unknown>> }>;
    const steps = jobs.e2e?.steps ?? [];
    const upload = steps.find((step) =>
      String(step.uses ?? "").startsWith("actions/upload-artifact@"),
    );

    expect(upload?.if).toBe("failure()");
    expect((upload?.with as { "retention-days"?: number })?.["retention-days"]).toBe(3);
  });
});
