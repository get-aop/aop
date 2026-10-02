import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const workflowText = await Bun.file(join(ROOT, ".github/workflows/nightly.yml")).text();
const deployText = await Bun.file(join(ROOT, "scripts/release/deploy-nightly.sh")).text();

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  environment?: string;
  needs?: string | string[];
  steps: Step[];
}
const workflow = Bun.YAML.parse(workflowText) as {
  on: Record<string, unknown>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
};

const secretsOf = (job: Job): string[] =>
  [...JSON.stringify(job).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1] ?? "");

describe("nightly workflow wiring", () => {
  test("builds as the nightly channel", () => {
    expect(workflow.env.AOP_BUILD_CHANNEL).toBe("nightly");
  });

  test("a workflow_run from a pull request, a fork or another branch never gets past resolve", () => {
    const gate = workflow.jobs.resolve?.if ?? "";
    expect(gate).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(gate).toContain("github.event.workflow_run.event == 'push'");
    expect(gate).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(gate).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    );
    expect(gate).toContain("vars.AOP_NIGHTLY_ENABLED == 'true'");
    expect(workflow.on.workflow_run).toMatchObject({ workflows: ["AOP CI"], branches: ["main"] });
  });

  test("only the nightly environment holds secrets, and only publishing runs enter it", () => {
    expect(workflow.jobs.publish?.environment).toBe("nightly");
    expect(workflow.jobs.publish?.if).toBe("needs.resolve.outputs.publish == 'true'");
    expect(workflow.jobs["package-macos"]?.environment).toBe(
      "${{ needs.resolve.outputs.publish == 'true' && 'nightly' || '' }}",
    );
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "publish" && name !== "package-macos") expect(secretsOf(job)).toEqual([]);
      expect(JSON.stringify(job)).not.toContain("environment: release");
    }
    // Stable's Cloudflare token can write stable's install.sh; nightly never reads it.
    expect(secretsOf(workflow.jobs.publish as Job).sort()).toEqual([
      "AOP_NIGHTLY_R2_ACCESS_KEY_ID",
      "AOP_NIGHTLY_R2_BUCKET",
      "AOP_NIGHTLY_R2_ENDPOINT",
      "AOP_NIGHTLY_R2_SECRET_ACCESS_KEY",
    ]);
  });

  test("a build that does not publish runs the deploy as a dry run", () => {
    const dry = workflow.jobs.assemble?.steps.find(
      (step) => step.name === "Dry run of the publish",
    );
    expect(dry?.env?.AOP_NIGHTLY_DRY_RUN).toBe("1");
    expect(dry?.if).toBe("needs.resolve.outputs.publish != 'true'");
  });

  test("the set the workflow checks is the set deploy-nightly.sh publishes", () => {
    const deployed = [...deployText.matchAll(/^ {2}"([^":]+):/gm)].map((match) => match[1]);
    const checkStep = workflow.jobs.assemble?.steps.find(
      (step) => step.name === "Check the nightly set",
    );
    const checked = (checkStep?.run ?? "")
      .split("done")[0]
      ?.match(/[a-z0-9.-]+\.(?:dmg|zip|yml|gz)|aop-(?:linux|darwin)-(?:x64|arm64)/g);
    expect(new Set(checked)).toEqual(
      new Set([...deployed.filter((name) => name !== "checksums.sha256"), "latest-mac.yml"]),
    );
  });
});
