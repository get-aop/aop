#!/usr/bin/env bun
/**
 * Publishes a fresh clean snapshot of aop-mono's main to the public repo
 * (get-aop/aop) as a single "Initial public release" commit.
 *
 * The public repo intentionally carries no history: the archive (aop-mono)
 * keeps the real commit history, and this script mirrors the archive's
 * current main tree as one orphan commit, force-pushed over the public main
 * (branch protection is suspended for the push and re-applied afterwards).
 *
 * Usage:
 *   bun run ./scripts/release/publish-public-snapshot.ts [--dry-run]
 */
// biome-ignore-all lint/suspicious/noConsole: release CLI reports progress to the operator

import { rm } from "node:fs/promises";
import { join } from "node:path";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const PUBLIC_REPO = "git@github.com:get-aop/aop.git";
const SNAPSHOT_MESSAGE = `Initial public release

Local-first orchestrator for coding-agent CLIs: Sessions UI, reusable
workflows (including armed in-chat workflow runs), isolated git worktrees,
live logs, and PR/CI handoff from a local dashboard.

Clean snapshot of the aop-mono archive at the 0.9.31 release.
See THIRD_PARTY_NOTICES.md for attribution (T3 Code, shadcn/ui,
Superpowers) and README.md for usage.`;

// Mirrors the branch protection configured on the public repo.
const BRANCH_PROTECTION = {
  required_status_checks: { strict: true, contexts: ["ci"] },
  enforce_admins: true,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: true,
  },
  restrictions: null,
};

const dryRun = process.argv.includes("--dry-run");

const run = async (command: string[]) => {
  if (dryRun) {
    console.log(`  [dry-run] ${command.join(" ")}`);
    return;
  }
  const result = await Bun.$`${command}`.cwd(WORKSPACE_ROOT).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stderr}`);
  }
};

const runOutput = async (command: string[]): Promise<string> => {
  const result = await Bun.$`${command}`.cwd(WORKSPACE_ROOT).quiet().text();
  return result.trim();
};

const main = async () => {
  console.log(dryRun ? "Public snapshot publish (DRY RUN)" : "Public snapshot publish");

  // 1. Align with the archive's remote main — snapshot whatever is current.
  await run(["git", "fetch", "origin", "main", "--tags"]);
  const archiveMain = await runOutput(["git", "rev-parse", "origin/main"]);
  console.log(`Archive main: ${archiveMain.slice(0, 9)}`);

  // 2. Build the orphan snapshot commit in a temp worktree.
  const worktreeDir = join("/tmp", `aop-public-snapshot-${Date.now()}`);
  await run(["git", "worktree", "add", worktreeDir, "origin/main"]);
  try {
    await run(["git", "-C", worktreeDir, "checkout", "--orphan", "public-main"]);
    await run(["git", "-C", worktreeDir, "rm", "-rfq", "--cached", "."]);
    await run(["git", "-C", worktreeDir, "add", "-A"]);
    await run([
      "git",
      "-C",
      worktreeDir,
      "-c",
      "user.name=AOP",
      "-c",
      "user.email=aop@getaop.com",
      "commit",
      "-q",
      "-m",
      SNAPSHOT_MESSAGE,
    ]);
    const snapshot = dryRun
      ? "dry-run"
      : await runOutput(["git", "-C", worktreeDir, "rev-parse", "HEAD"]);
    console.log(`Snapshot commit: ${snapshot.slice(0, 9)}`);

    // 3. Suspended protection -> force-push -> re-apply protection.
    if (!dryRun) {
      await Bun.$`gh api -X DELETE repos/get-aop/aop/branches/main/protection --silent`.cwd(
        WORKSPACE_ROOT,
      );
      console.log("Branch protection suspended");
    }
    await run(["git", "-C", worktreeDir, "push", "-f", PUBLIC_REPO, "public-main:main"]);
    if (!dryRun) {
      const protectionPath = join("/tmp", `aop-protection-${Date.now()}.json`);
      await Bun.write(protectionPath, JSON.stringify(BRANCH_PROTECTION));
      const result =
        await Bun.$`gh api -X PUT repos/get-aop/aop/branches/main/protection --input ${protectionPath} --silent`
          .cwd(WORKSPACE_ROOT)
          .nothrow();
      await rm(protectionPath, { force: true });
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to re-apply branch protection: ${result.stderr}\nRe-apply manually:\n  gh api -X PUT repos/get-aop/aop/branches/main/protection --input <protection.json>`,
        );
      }
      console.log("Branch protection re-applied");
    }
  } finally {
    await run(["git", "worktree", "remove", worktreeDir, "--force"]);
  }

  console.log("");
  console.log("Public repo updated. CI runs from the push; verify with:");
  console.log("  gh run list --repo get-aop/aop --branch main");
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
