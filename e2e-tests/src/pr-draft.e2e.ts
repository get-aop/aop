import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import {
  createTestContext,
  destroyTestContext,
  e2eDescribe,
  getFullStatus,
  runAopCommand,
  type TestContext,
  triggerServerRefresh,
} from "./helpers";

const E2E_TIMEOUT = 240_000;

const FAKE_GH_SCRIPT = `#!/usr/bin/env bash
echo "$@" >> "\${AOP_FAKE_GH_LOG}"
case "$1 $2" in
  "auth status") exit 0 ;;
  "pr list")
    if [ -f "\${AOP_FAKE_GH_PR_STATE}" ]; then
      cat "\${AOP_FAKE_GH_PR_STATE}"
    else
      printf '[]\\n'
    fi
    exit 0 ;;
  "pr create")
    printf 'https://github.com/acme/widget/pull/42\\n'
    cat > "\${AOP_FAKE_GH_PR_STATE}" <<'EOF'
[{"number":42,"url":"https://github.com/acme/widget/pull/42","state":"OPEN","title":"Fix the checkout race","mergeable":"MERGEABLE","baseRefName":"main","headRefName":"feature/pr-draft"}]
EOF
    exit 0 ;;
  "pr checks") printf '[]\\n'; exit 0 ;;
esac
exit 0
`;

/** Prints a codex-style JSONL log whose final assistant message is the draft JSON. */
const FAKE_CODEX_SCRIPT = `#!/usr/bin/env bash
echo "$@" > "\${AOP_FAKE_CODEX_LOG}"
printf '%s\\n' \\
  '{"type":"thread.started","thread_id":"fake-thread"}' \\
  '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"title\\": \\"Fix the checkout race\\", \\"body\\": \\"- Fixed the race\\\\n- Added tests\\"}"}}' \\
  '{"type":"turn.completed","last-assistant-message":"{\\"title\\": \\"Fix the checkout race\\", \\"body\\": \\"- Fixed the race\\\\n- Added tests\\"}"}'
exit 0
`;

const FAKE_OPEN_SCRIPT = `#!/usr/bin/env bash
echo "$@" > "\${AOP_FAKE_OPEN_LOG}"
exit 0
`;

/** Sandboxed gh/codex/open on PATH so the real CLIs and the real browser never run. */
const writeFakeBins = async (binDir: string, stateDir: string): Promise<void> => {
  await mkdir(binDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const writeExecutable = async (name: string, content: string) => {
    const path = join(binDir, name);
    await writeFile(path, content);
    await chmod(path, 0o755);
  };
  await writeExecutable("gh", FAKE_GH_SCRIPT);
  await writeExecutable("codex", FAKE_CODEX_SCRIPT);
  await writeExecutable("open", FAKE_OPEN_SCRIPT);
};

e2eDescribe("session PR draft e2e", () => {
  let ctx: TestContext;
  let browser: Browser;
  let page: Page;
  let repoPath: string;
  let worktreePath: string;
  let repoId: string;
  let sessionId: string;
  let stateDir: string;
  let ghLogPath: string;
  let codexLogPath: string;
  let openLogPath: string;

  beforeAll(async () => {
    const baseDir = join(import.meta.dir, "../tmp/pr-draft-e2e");
    await rm(baseDir, { recursive: true, force: true });
    stateDir = join(baseDir, "fake-state");
    const binDir = join(baseDir, "fake-bin");
    ghLogPath = join(stateDir, "gh.log");
    codexLogPath = join(stateDir, "codex.log");
    openLogPath = join(stateDir, "open.log");
    await writeFakeBins(binDir, stateDir);

    ctx = await createTestContext("pr-draft", {
      localServerEnv: {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        AOP_FAKE_GH_LOG: ghLogPath,
        AOP_FAKE_GH_PR_STATE: join(stateDir, "pr.json"),
        AOP_FAKE_CODEX_LOG: codexLogPath,
        AOP_FAKE_OPEN_LOG: openLogPath,
      },
    });

    // Real git repo with a bare origin (main pushed) and a linked session worktree.
    repoPath = join(ctx.reposDir, "widget");
    const originPath = join(ctx.reposDir, "widget-origin.git");
    await mkdir(repoPath, { recursive: true });
    await Bun.$`git init -b main`.cwd(repoPath).quiet();
    await Bun.$`git config user.email e2e@aop.dev`.cwd(repoPath).quiet();
    await Bun.$`git config user.name "E2E"`.cwd(repoPath).quiet();
    await writeFile(join(repoPath, "README.md"), "# widget\n");
    await Bun.$`git add .`.cwd(repoPath).quiet();
    await Bun.$`git commit -m "Initial commit"`.cwd(repoPath).quiet();
    await Bun.$`git init --bare ${originPath}`.cwd(repoPath).quiet();
    await Bun.$`git remote add origin ${originPath}`.cwd(repoPath).quiet();
    await Bun.$`git push -u origin main`.cwd(repoPath).quiet();
    worktreePath = join(ctx.baseDir, "worktrees", "widget-wt");
    await Bun.$`git worktree add -b feature/pr-draft ${worktreePath}`.cwd(repoPath).quiet();

    const { exitCode } = await runAopCommand(["repo:init", repoPath], undefined, ctx.env);
    expect(exitCode).toBe(0);
    await triggerServerRefresh(ctx.localServerUrl);

    const status = await getFullStatus(ctx.env);
    repoId = status?.repos.find((entry) => entry.path === repoPath)?.id ?? "";

    // Chat session bound to the worktree, running the codex-cli runtime.
    const created = await fetch(`${ctx.localServerUrl}/api/chat-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId }),
    });
    expect(created.status).toBe(201);
    sessionId = ((await created.json()) as { session: { id: string } }).session.id;

    const bound = await fetch(`${ctx.localServerUrl}/api/chat-sessions/${sessionId}/workspace`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: worktreePath }),
    });
    expect(bound.status).toBe(200);

    // Pin the session to the fake codex runtime and seed the task conversation.
    const db = new Database(ctx.dbPath);
    try {
      db.run(
        `UPDATE chat_sessions SET runtime = 'codex-cli', runtime_alias = NULL, model = 'gpt-5.5', reasoning_effort = 'medium' WHERE id = ?`,
        [sessionId],
      );
      db.run(
        `INSERT INTO chat_messages (id, session_id, role, content, created_at)
         VALUES (?, ?, 'user', 'Fix the checkout race in the widget app', ?)`,
        [`smsg_pr_draft_e2e`, sessionId, new Date().toISOString()],
      );
    } finally {
      db.close();
    }

    // Dirty the worktree so the flow exercises the auto-commit path.
    await writeFile(join(worktreePath, "README.md"), "# widget\n\nCheckout fix\n");

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, E2E_TIMEOUT);

  afterAll(async () => {
    await browser?.close();
    await destroyTestContext(ctx);
    await rm(join(import.meta.dir, "../tmp/pr-draft-e2e"), { recursive: true, force: true });
  }, E2E_TIMEOUT);

  const openSessionView = async (): Promise<void> => {
    await page.goto(ctx.dashboardUrl);
    await page.evaluate((id) => sessionStorage.setItem("aop.sessions.activeId", id), sessionId);
    await page.reload();
    await page
      .getByTestId("session-source-control-actions")
      .waitFor({ state: "visible", timeout: 30_000 });
  };

  /** The server unrefs the `open` child; poll until its log lands. */
  const waitForOpenLog = async (path: string, timeoutMs = 5_000): Promise<string> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        return await readFile(path, "utf8");
      } catch {
        await Bun.sleep(100);
      }
    }
    throw new Error(`open log was not written within ${timeoutMs}ms`);
  };

  test(
    "creates a PR with a runtime-generated title and body, then View PR opens GitHub",
    async () => {
      await openSessionView();

      // The top bar offers the combined commit+push+PR action for the dirty worktree.
      const primary = page.getByTestId("session-source-control-primary");
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="session-source-control-primary"]')
            ?.textContent?.includes("Commit, push & PR") ?? false,
        undefined,
        { timeout: 30_000 },
      );
      await primary.click();

      // PR #42 created toast after commit → push → draft generation → gh pr create.
      await page.getByText(/PR #42 created/).waitFor({ state: "visible", timeout: 60_000 });

      // The fake codex CLI received a summary prompt about the session task.
      const codexLog = await readFile(codexLogPath, "utf8");
      expect(codexLog).toContain("Fix the checkout race in the widget app");
      expect(codexLog).toContain("README.md");
      expect(codexLog).toContain("--sandbox");
      expect(codexLog).toContain("read-only");

      // The fake gh CLI created the PR with the generated title and body.
      const ghLog = await readFile(ghLogPath, "utf8");
      expect(ghLog).toContain("pr create --title Fix the checkout race --body - Fixed the race");
      expect(ghLog).toContain("- Added tests --base main --head feature/pr-draft");

      // Once the PR is open the same control becomes View PR.
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="session-source-control-primary"]')
            ?.textContent?.includes("View PR") ?? false,
        undefined,
        { timeout: 30_000 },
      );
      await page.getByTestId("session-source-control-primary").click();

      // The opener request carries the PR URL and the server opens it via `open`.
      const response = await page.waitForResponse(
        (r) => r.url().endsWith("/api/open-external") && r.status() === 200,
        { timeout: 15_000 },
      );
      expect(response.request().postData()).toContain(
        '{"url":"https://github.com/acme/widget/pull/42"}',
      );
      const openLog = await waitForOpenLog(openLogPath);
      expect(openLog).toContain("https://github.com/acme/widget/pull/42");
    },
    E2E_TIMEOUT,
  );
});
