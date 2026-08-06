import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright";
import {
  copyFixture,
  createTempRepo,
  createTestContext,
  DASHBOARD_DIST_PATH,
  destroyTestContext,
  e2eDescribe,
  getFullStatus,
  runAopCommand,
  seedE2EWorkflow,
  setTaskStatus,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 240_000;
const DONE_TASK_TIMEOUT_MS = 90_000;
const SCREENSHOT_DIR = join(import.meta.dir, "../tmp/screenshots");

const ensureDashboardBuilt = async (): Promise<void> => {
  const dashboardDir = join(DASHBOARD_DIST_PATH, "..");
  const result = await Bun.$`bun run build`.cwd(dashboardDir).quiet();
  if (result.exitCode !== 0) {
    throw new Error(`Dashboard build failed: ${result.stderr.toString()}`);
  }
};

const waitForElement = async (
  page: Page,
  selector: string,
  options: { timeout?: number; state?: "visible" | "attached" } = {},
): Promise<boolean> => {
  try {
    await page.waitForSelector(selector, {
      timeout: options.timeout ?? 10_000,
      state: options.state ?? "visible",
    });
    return true;
  } catch {
    return false;
  }
};

/** Radix dialogs (Settings, Attach repo, confirms) render role=dialog/alertdialog. */
const waitForOpenDialog = async (page: Page, timeout = 5_000): Promise<boolean> => {
  return waitForElement(
    page,
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    {
      timeout,
      state: "attached",
    },
  );
};

const getOpenDialog = (page: Page): Locator =>
  page
    .locator('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
    .last();

const waitForUrlPathname = async (
  page: Page,
  pathname: string,
  timeout = 10_000,
): Promise<void> => {
  await page.waitForURL((url) => url.pathname === pathname, { timeout });
};

const openRegisterRepositoryDialog = async (page: Page): Promise<void> => {
  // The attach dialog opens from the rail's Projects “+”.
  await page.goto(new URL(page.url()).origin);
  await page.getByTestId("rail-attach-repo").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("rail-attach-repo").click();
};

const openTaskDetail = async (page: Page, taskId: string, baseUrl: string): Promise<void> => {
  // Prefer deep-link navigation (chat cards also deep-link here).
  const base = new URL(baseUrl).origin;
  await page.goto(`${base}/tasks/${encodeURIComponent(taskId)}`);
  expect(await waitForElement(page, '[data-testid="task-detail"]')).toBe(true);
};

const openLogsTab = async (page: Page): Promise<void> => {
  await page.locator('[data-testid="tab-logs"]').click();
  expect(await waitForElement(page, '[data-testid="execution-history"]')).toBe(true);
};

const selectLatestExecution = async (page: Page): Promise<void> => {
  const executionItems = page.locator('[data-testid^="execution-item-"]');
  expect(await executionItems.count()).toBeGreaterThan(0);
  await executionItems.last().locator("button").first().click();
};

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
};

const createE2EWorker = async (
  localServerUrl: string,
  repoIds: string[],
  name = `E2E Worker ${Date.now()}`,
): Promise<string> => {
  const response = await fetch(`${localServerUrl}/api/agents/workers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      role: "developer",
      repoIds,
      workflowId: "aop-default-gpt",
      model: "default",
    }),
  });

  const responseText = await response.text();
  if (response.status !== 201) {
    throw new Error(`Failed to create worker profile: ${response.status} ${responseText}`);
  }

  const body = JSON.parse(responseText) as { agent: { id: string } };
  return body.agent.id;
};

const assignTaskToWorker = async (
  localServerUrl: string,
  repoId: string,
  taskId: string,
  agentId: string,
): Promise<void> => {
  const response = await fetch(`${localServerUrl}/api/repos/${repoId}/tasks/${taskId}/assignment`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to assign task: ${response.status} ${await response.text()}`);
  }

  await triggerServerRefresh(localServerUrl);
};

const createChatSession = async (localServerUrl: string, repoId: string): Promise<string> => {
  const response = await fetch(`${localServerUrl}/api/chat-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { session: { id: string } };
  return body.session.id;
};

/** Seed a user message so the chat renders a markdown file chip. */
const seedMarkdownMessage = (dbPath: string, sessionId: string, fileName: string): void => {
  const db = new Database(dbPath);
  try {
    db.run(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at)
       VALUES (?, ?, 'user', ?, ?)`,
      [
        `smsg_e2e_md_${Date.now()}`,
        sessionId,
        `See \`${fileName}\` for the plan.`,
        new Date().toISOString(),
      ],
    );
  } finally {
    db.close();
  }
};

/**
 * Seed a delegation run the way the chat pipeline persists one: a chat run
 * row plus its delegation entries. Keeps the Tasks-pane regression test
 * deterministic — no real runtime needed.
 */
const seedDelegationRun = (dbPath: string, sessionId: string, label: string): void => {
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    const seedId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const messageId = `smsg_e2e_seed_${seedId}`;
    const runId = `crun_e2e_seed_${seedId}`;
    const delegationId = `del_e2e_seed_${seedId}`;
    db.run(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at)
       VALUES (?, ?, 'user', 'seed delegation', ?)`,
      [messageId, sessionId, now],
    );
    db.run(
      `INSERT INTO chat_runs (id, session_id, user_message_id, assistant_message_id, runtime, log_file_path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'claude-code', '/tmp/e2e-seed.jsonl', 'completed', ?, ?)`,
      [runId, sessionId, messageId, messageId, now, now],
    );
    db.run(
      `INSERT INTO chat_delegation_runs (id, chat_run_id, kind, label, runtime, model, reasoning, status, log_file_path, started_at, updated_at)
       VALUES (?, ?, 'delegation', ?, 'codex-cli', 'gpt-5.5', 'medium', 'completed', '/tmp/e2e-seed-delegate.jsonl', ?, ?)`,
      [delegationId, runId, label, now, now],
    );
  } finally {
    db.close();
  }
};

const ensureWorkflowsReady = async (localServerUrl: string): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(`${localServerUrl}/api/workflows`);
    if (response.ok) {
      const body = (await response.json()) as { workflows?: string[] };
      if (body.workflows?.includes("aop-default-gpt")) {
        return;
      }
    }

    await triggerServerRefresh(localServerUrl);
    await Bun.sleep(250);
  }

  // The retired built-in catalog no longer ships workflows: seed one so the
  // worker creation and composer-picker steps below have a real workflow.
  await seedE2EWorkflow(localServerUrl);
};

/**
 * The rail is the only chrome now (PLAN §3). Legacy routes redirect to “/”.
 * For /tasks/:id the task detail renders beside the rail.
 */
const expectRailAvailable = async (
  page: Page,
  dashboardUrl: string,
  routePath: string,
  routeReadySelector: string,
): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${dashboardUrl}${routePath}`);
  expect(await waitForElement(page, '[data-testid="app-rail"]')).toBe(true);
  expect(await waitForElement(page, routeReadySelector)).toBe(true);

  if (routePath !== "/" && !routePath.startsWith("/tasks/")) {
    // Legacy routes redirect to the one-page app.
    await waitForUrlPathname(page, "/");
  }

  expect(await page.getByTestId("rail-new-session").isVisible()).toBe(true);
  expect(await page.getByTestId("rail-footer-settings").isVisible()).toBe(true);
};

e2eDescribe("dashboard E2E tests", () => {
  let ctx: TestContext;
  let browser: Browser;
  let page: Page;
  let repo: TempRepoResult;
  let repoId: string;
  let workerAgentId: string;
  let taskId: string;
  let dashboardUrl: string;
  let regDir: string;
  let plainDir: string;

  beforeAll(async () => {
    await ensureDashboardBuilt();
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    ctx = await createTestContext("dashboard", {
      localServerEnv: {
        DASHBOARD_STATIC_PATH: DASHBOARD_DIST_PATH,
        AOP_E2E_FIXTURE_DELAY_MS: "1500",
      },
    });
    dashboardUrl = ctx.localServerUrl;

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    page.setDefaultTimeout(30_000);

    repo = await createTempRepo("dashboard-e2e", ctx.reposDir);

    // Reachable git repo for the attach dialog (browser starts at $HOME).
    const stamp = `${Date.now()}`;
    regDir = join(homedir(), `aop-e2e-register-${stamp}`);
    plainDir = join(homedir(), `aop-e2e-plain-${stamp}`);
    await Bun.$`mkdir -p ${regDir}`.quiet();
    await Bun.$`git init -q ${regDir}`.quiet();
    await Bun.$`mkdir -p ${plainDir}`.quiet();
  }, E2E_TIMEOUT);

  afterAll(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
    if (repo) await repo.cleanup(ctx.env);
    await rm(regDir, { recursive: true, force: true }).catch(() => {});
    await rm(plainDir, { recursive: true, force: true }).catch(() => {});
    await destroyTestContext(ctx);
  }, E2E_TIMEOUT);

  describe("happy path", () => {
    test(
      "13.1.1 - Create a new test repository with a fixture task",
      async () => {
        await copyFixture("backlog-test", repo.path);
        await Bun.$`git add .`.cwd(repo.path).quiet();
        await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

        const { exitCode } = await runAopCommand(["repo:init", repo.path], undefined, ctx.env);
        expect(exitCode).toBe(0);

        await triggerServerRefresh(ctx.localServerUrl);
        await Bun.sleep(1000);

        const { exitCode: statusExit, stdout } = await runAopCommand(
          ["status", join(repo.path, "docs/tasks/backlog-test"), "--json"],
          undefined,
          ctx.env,
        );
        expect(statusExit).toBe(0);

        const task = JSON.parse(stdout);
        expect(task.status).toBe("DRAFT");
        expect(task.id).toStartWith("task_");
        taskId = task.id;

        const status = await getFullStatus(ctx.env);
        const registeredRepo = status?.repos.find((entry) => entry.path === repo.path);
        expect(registeredRepo).toBeTruthy();
        repoId = registeredRepo?.id ?? "";
        await ensureWorkflowsReady(ctx.localServerUrl);
        workerAgentId = await createE2EWorker(ctx.localServerUrl, [repoId]);
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.2 - Fixture task opens on its detail route (new IA surface)",
      async () => {
        await openTaskDetail(page, taskId, dashboardUrl);
        const badge = page.getByTestId("task-status-badge");
        await badge.waitFor({ state: "visible", timeout: 10_000 });
        expect((await badge.textContent()) ?? "").toContain("To do");

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "01-task-detail-draft.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.2a - The rail is the only chrome; legacy routes redirect to /",
      async () => {
        await expectRailAvailable(page, dashboardUrl, "/", '[data-testid="sessions-page"]');
        await expectRailAvailable(page, dashboardUrl, "/metrics", '[data-testid="sessions-page"]');
        await expectRailAvailable(page, dashboardUrl, "/pool", '[data-testid="sessions-page"]');
        await expectRailAvailable(page, dashboardUrl, "/settings", '[data-testid="sessions-page"]');
        await expectRailAvailable(
          page,
          dashboardUrl,
          `/tasks/${taskId}`,
          '[data-testid="task-detail"]',
        );

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "13-rail-on-detail-route.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.2b - Dark-only: no theme toggle, no light mode",
      async () => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(dashboardUrl);
        expect(await waitForElement(page, '[data-testid="app-rail"]')).toBe(true);
        expect(await page.getByRole("switch").count()).toBe(0);
        expect(await page.locator('html[data-theme="dark"]').count()).toBe(1);

        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        await page.screenshot({
          path: join(SCREENSHOT_DIR, "13-dark-only.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.2c - Responsive: desktop rail, mobile/tablet render the workspace",
      async () => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(dashboardUrl);
        expect(await waitForElement(page, '[data-testid="app-rail"]')).toBe(true);
        expect(await waitForElement(page, '[data-testid="sessions-page"]')).toBe(true);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: join(SCREENSHOT_DIR, "13-responsive-desktop.png"),
          fullPage: true,
        });

        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto(dashboardUrl);
        expect(await waitForElement(page, '[data-testid="sessions-page"]')).toBe(true);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: join(SCREENSHOT_DIR, "13-responsive-tablet.png"),
          fullPage: true,
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(dashboardUrl);
        expect(await waitForElement(page, '[data-testid="sessions-page"]')).toBe(true);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: join(SCREENSHOT_DIR, "13-responsive-mobile.png"),
          fullPage: true,
        });

        // Restore the desktop viewport so later rail-driven scenarios can click it.
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(dashboardUrl);
        expect(await waitForElement(page, '[data-testid="app-rail"]')).toBe(true);
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.2d - Sessions uses explicit Quick Actions and workflow picks",
      async () => {
        const createResponse = await fetch(`${ctx.localServerUrl}/api/chat-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoId }),
        });
        expect(createResponse.status).toBe(201);
        const created = (await createResponse.json()) as { session: { id: string } };

        await page.goto(dashboardUrl);
        await page.evaluate(
          (sessionId) => sessionStorage.setItem("aop.sessions.activeId", sessionId),
          created.session.id,
        );
        await page.reload();
        const composer = page.getByTestId("chat-composer-input");
        await composer.waitFor({ state: "visible" });

        await composer.fill("Ask PI and OpenCode to compare approaches");
        expect(await page.getByText(/Delegate to/).count()).toBe(0);

        await composer.fill("/");
        await page.getByText("/review", { exact: true }).click();
        await page.getByRole("button", { name: /Codex/ }).first().click();
        expect(await composer.inputValue()).toBe("");
        expect(await page.getByTestId("composer-runtime-action-review").isVisible()).toBe(true);
        await page.getByRole("button", { name: "Remove review action" }).click();

        await composer.fill("#aop");
        await page.getByText("aop-default-gpt", { exact: true }).click();
        expect(await composer.inputValue()).toBe("");
        expect(await page.getByTestId("composer-workflow-selection").isVisible()).toBe(true);
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.2e - Workflows live inside Settings, not on a page",
      async () => {
        await page.goto(dashboardUrl);
        await page.getByTestId("rail-footer-settings").click();
        expect(await waitForOpenDialog(page)).toBe(true);
        expect(await waitForElement(page, '[data-testid="settings-dialog"]')).toBe(true);

        await page.locator('[data-testid="settings-nav-workflows"]').click();
        expect(await waitForElement(page, '[data-testid="section-workflows"]')).toBe(true);

        // The catalog (builtin + “Ship it” seed) is always non-empty. The list
        // populates after an async fetch (+ first-open seed round-trip), so wait
        // for the first row before counting — same assertion, no race.
        expect(await waitForElement(page, '[data-testid="workflow-row"]')).toBe(true);
        const rows = page.locator('[data-testid="workflow-row"]');
        expect(await rows.count()).toBeGreaterThan(0);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "13-workflows-in-settings.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.3 - Mark task ready using the Dashboard UI",
      async () => {
        await assignTaskToWorker(ctx.localServerUrl, repoId, taskId, workerAgentId);
        await openTaskDetail(page, taskId, dashboardUrl);

        const markReadyButton = page.locator('[data-testid="mark-ready-button"]');
        const buttonVisible = await markReadyButton.isVisible();
        expect(buttonVisible).toBe(true);

        await markReadyButton.click();
        const readyTask = await waitForTask(taskId, ["READY", "WORKING", "RESUMING"], {
          timeout: 30_000,
          pollInterval: 1000,
          localServerUrl: ctx.localServerUrl,
        });
        expect(readyTask).not.toBeNull();

        await page.waitForTimeout(1000);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "03-after-mark-ready.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.4 - Task is picked up and runs to completion",
      async () => {
        const completedTask = await waitForTask(taskId, ["DONE"], {
          timeout: DONE_TASK_TIMEOUT_MS,
          pollInterval: 2000,
          localServerUrl: ctx.localServerUrl,
        });
        expect(completedTask).not.toBeNull();
        expect(completedTask?.status).toBe("DONE");
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.6 - Task detail shows the Done status and execution history",
      async () => {
        await openTaskDetail(page, taskId, dashboardUrl);
        const badge = page.getByTestId("task-status-badge");
        await badge.waitFor({ state: "visible", timeout: 10_000 });
        expect((await badge.textContent()) ?? "").toContain("Done");

        await openLogsTab(page);
        expect(await waitForElement(page, '[data-testid^="execution-item-"]')).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "06-task-done-logs.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.7 - Drill down into complete task and view execution history and logs",
      async () => {
        await openTaskDetail(page, taskId, dashboardUrl);

        await openLogsTab(page);
        expect(await waitForElement(page, '[data-testid^="execution-item-"]')).toBe(true);

        const executionItems = page.locator('[data-testid^="execution-item-"]');
        const count = await executionItems.count();
        expect(count).toBeGreaterThan(0);

        await selectLatestExecution(page);
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "08-execution-logs.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );
  });

  describe("regression fixes: right panel tabs, workflow fire, task detail", () => {
    let fixRepo: TempRepoResult;
    let fixRepoId: string;
    let fireSessionId: string;
    let tasksSessionId: string;

    beforeAll(async () => {
      fixRepo = await createTempRepo("dashboard-fixes-e2e", ctx.reposDir);
      await copyFixture("backlog-test", fixRepo.path);
      await Bun.$`git add .`.cwd(fixRepo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(fixRepo.path).quiet();
      // The diffstat chip only renders off the default branch, so the
      // regression test exercises it on a feature branch.
      await Bun.$`git checkout -b e2e-feature`.cwd(fixRepo.path).quiet();

      const { exitCode } = await runAopCommand(["repo:init", fixRepo.path], undefined, ctx.env);
      expect(exitCode).toBe(0);
      await triggerServerRefresh(ctx.localServerUrl);
      await Bun.sleep(1000);

      const status = await getFullStatus(ctx.env);
      const registered = status?.repos.find((entry) => entry.path === fixRepo.path);
      expect(registered).toBeTruthy();
      fixRepoId = registered?.id ?? "";

      fireSessionId = await createChatSession(ctx.localServerUrl, fixRepoId);
      tasksSessionId = await createChatSession(ctx.localServerUrl, fixRepoId);

      // Long markdown fixture for the md-panel layout regression test.
      const mdLines: string[] = [];
      for (let i = 0; i < 140; i++) {
        mdLines.push(`## Section ${i}`, `Paragraph ${i} with some body text and \`inline code\`.`);
      }
      await Bun.write(`${fixRepo.path}/research.md`, mdLines.join("\n"));
      await Bun.$`git add research.md`.cwd(fixRepo.path).quiet();
      await Bun.$`git commit -m "Add research.md"`.cwd(fixRepo.path).quiet();
    }, E2E_TIMEOUT);

    afterAll(async () => {
      if (fixRepo) await fixRepo.cleanup(ctx.env);
    }, E2E_TIMEOUT);

    const openActiveSession = async (sessionId: string): Promise<void> => {
      await page.goto(dashboardUrl);
      await page.evaluate((id) => sessionStorage.setItem("aop.sessions.activeId", id), sessionId);
      await page.reload();
      await page.getByTestId("chat-composer-input").waitFor({ state: "visible" });
    };

    test(
      "diff tab: one tab row in the right panel, no legacy chrome",
      async () => {
        // Dirty the workspace so the diffstat chip appears in the composer.
        await Bun.$`echo "e2e dirty line" >> ${fixRepo.path}/task.md`.quiet();
        await triggerServerRefresh(ctx.localServerUrl);
        await openActiveSession(fireSessionId);

        const diffstat = page.getByTestId("session-git-diffstat");
        await diffstat.waitFor({ state: "visible", timeout: 15_000 });
        await diffstat.click();

        await page.getByTestId("session-diff-panel").waitFor({ state: "visible", timeout: 15_000 });
        expect(await page.getByTestId("right-panel").isVisible()).toBe(true);

        // The workspace tab row is the only tab chrome.
        for (const tabName of ["Diff", "Tasks", "Checks", "Log"]) {
          expect(
            await page.getByRole("tab", { name: new RegExp(tabName) }).count(),
          ).toBeGreaterThan(0);
        }
        expect(await page.getByTestId("session-right-panel").count()).toBe(0);
        expect(await page.getByLabel("Add panel surface").count()).toBe(0);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "fix-01-diff-single-tab-row.png"),
          fullPage: true,
        });

        await Bun.$`git checkout -- .`.cwd(fixRepo.path).quiet();
      },
      E2E_TIMEOUT,
    );

    test(
      "workflow fire: chip pick arms the run and the message sends without a selection error",
      async () => {
        // Seed a one-step workflow so the armed run stays short (runs for real
        // on dev machines, fails fast on CI boxes without the CLI).
        const seed = await fetch(`${ctx.localServerUrl}/api/workflows`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "e2e-fire-test",
            steps: [
              {
                skillId: "implement",
                agent: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium" },
              },
            ],
          }),
        });
        expect(seed.status).toBe(201);

        await openActiveSession(fireSessionId);

        // Pick the workflow from the composer chip.
        await page.getByTestId("composer-workflow-chip").click();
        await page.getByText("e2e-fire-test", { exact: true }).click();

        // The chip rail shows the fire button; the glyph rail must not duplicate it.
        const arm = page.getByTestId("composer-workflow-arm");
        await arm.waitFor({ state: "visible", timeout: 15_000 });
        expect(await page.getByTestId("composer-workflow-selection").count()).toBe(0);

        // Arm: the flame turns red and stays armed.
        await arm.click();
        expect(await arm.getAttribute("aria-pressed")).toBe("true");
        expect(await page.locator(".aop-flame-armed").count()).toBeGreaterThan(0);

        // Send the armed message.
        const assistantTurnsBeforeRun = await page.getByTestId("assistant-message-content").count();
        await page.getByTestId("chat-composer-input").fill("Run the fire workflow");
        await page.getByRole("button", { name: "Send message" }).click();

        // The message posts and the run starts — no "select a workflow" rejection.
        await page
          .getByText("Run the fire workflow")
          .waitFor({ state: "visible", timeout: 15_000 });
        expect(
          await page.getByText("Select a workflow before arming the fire button.").count(),
        ).toBe(0);

        // The fixture run can finish before Chromium paints the transient
        // running badge. Its durable completion signal is the assistant turn
        // persisted and published by postWorkflowRunAnswer.
        await page.waitForFunction(
          (previousCount) =>
            document.querySelectorAll('[data-testid="assistant-message-content"]').length >
            previousCount,
          assistantTurnsBeforeRun,
          { timeout: 180_000 },
        );

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "fix-02-fire-armed-run.png"),
          fullPage: true,
        });

        // The run finishes and unlocks the composer.
        expect(await page.getByTestId("composer-workflow-running").count()).toBe(0);
        expect(await page.getByTestId("chat-composer-input").isEnabled()).toBe(true);
      },
      E2E_TIMEOUT,
    );

    test(
      "tasks tab: delegation detail opens as a non-modal panel and closing keeps the row",
      async () => {
        seedDelegationRun(ctx.dbPath, tasksSessionId, "E2E background review");
        await openActiveSession(tasksSessionId);

        // Open the right panel at the Tasks tab.
        await page.getByTestId("composer-tasks-button").click();
        await page.getByTestId("tasks-pane").waitFor({ state: "visible", timeout: 15_000 });

        // The seeded delegation shows up as a finished row.
        const row = page.getByTestId("tasks-row").first();
        await row.waitFor({ state: "visible", timeout: 20_000 });
        expect(await row.textContent()).toContain("E2E background review");

        // Clicking opens the non-modal detail overlay, not a blocking dialog.
        await row.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        expect(await dialog.getAttribute("aria-modal")).toBe("false");
        expect(await dialog.textContent()).toContain("No output recorded.");

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "fix-03-task-detail-non-modal.png"),
          fullPage: true,
        });

        // The app stays interactive behind it; closing keeps the task in the list.
        await page.getByRole("button", { name: "Back to conversation" }).click();
        await dialog.waitFor({ state: "detached", timeout: 10_000 });
        expect(await page.getByTestId("tasks-row").count()).toBe(1);
      },
      E2E_TIMEOUT,
    );

    test(
      "markdown panel: view mode keeps the page viewport-height and the panel scrolls",
      async () => {
        seedMarkdownMessage(ctx.dbPath, fireSessionId, "research.md");
        await openActiveSession(fireSessionId);

        // Open the long research.md in the side panel.
        const chip = page.getByTestId("markdown-file-chip-tile").first();
        await chip.waitFor({ state: "visible", timeout: 15_000 });
        await chip.click();
        await page
          .getByTestId("session-markdown-panel")
          .waitFor({ state: "visible", timeout: 15_000 });

        // Wait until the file content has rendered (the panel mounts loading).
        await page.waitForFunction(
          () => {
            const rendered = document.querySelector(
              '[data-testid="session-markdown-panel"] .chat-markdown',
            );
            return (rendered?.textContent?.length ?? 0) > 500;
          },
          undefined,
          { timeout: 20_000 },
        );

        // Regression: the panel used to stretch the whole page to the markdown
        // content height, pushing the composer off-screen and leaving the
        // panel body with nothing to scroll.
        const layout = await page.evaluate(() => {
          const panel = document.querySelector('[data-testid="session-markdown-panel"]');
          const scroller = panel?.querySelector(".overflow-auto");
          return {
            pageHeight: document.body.scrollHeight,
            viewport: window.innerHeight,
            panelHeight: panel?.getBoundingClientRect().height ?? 0,
            scroller:
              scroller instanceof HTMLElement
                ? { client: scroller.clientHeight, scroll: scroller.scrollHeight }
                : null,
          };
        });
        expect(layout.pageHeight).toBeLessThanOrEqual(layout.viewport);
        expect(layout.panelHeight).toBeLessThanOrEqual(layout.viewport);
        expect(layout.scroller).not.toBeNull();
        const scroller = layout.scroller;
        if (scroller) {
          expect(scroller.scroll).toBeGreaterThan(scroller.client);
        }

        // The panel body actually scrolls.
        const scrolled = await page.evaluate(() => {
          const scroller = document.querySelector(
            '[data-testid="session-markdown-panel"] .overflow-auto',
          );
          if (!(scroller instanceof HTMLElement)) return 0;
          scroller.scrollTop = 800;
          return scroller.scrollTop;
        });
        expect(scrolled).toBeGreaterThan(0);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "fix-04-md-panel-view-height.png"),
        });
      },
      E2E_TIMEOUT,
    );
  });

  describe("repo registration", () => {
    test(
      "Register repository via the attach dialog (git repo arms Attach)",
      async () => {
        await page.goto(dashboardUrl);
        await page.waitForTimeout(1000);

        await openRegisterRepositoryDialog(page);
        expect(await waitForOpenDialog(page)).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "register-01-dialog-open.png"),
          fullPage: true,
        });

        // The browser starts at $HOME; our git fixture folder is a direct child.
        const regName = regDir.split("/").pop() ?? regDir;
        await page.locator('[data-testid="attach-repo-dir"]', { hasText: regName }).first().click();
        expect(await waitForElement(page, '[data-testid="attach-repo-git-badge"]')).toBe(true);

        const confirm = page.locator('[data-testid="attach-repo-confirm"]');
        expect(await confirm.isEnabled()).toBe(true);
        await confirm.click();

        await page.waitForTimeout(2000);
        await page.screenshot({
          path: join(SCREENSHOT_DIR, "register-02-registered.png"),
          fullPage: true,
        });

        // Attaching the git fixture succeeds (or reports already attached).
        const attached = await page
          .getByText(/Repository attached|Repository already attached/)
          .isVisible()
          .catch(() => false);
        expect(attached).toBe(true);
      },
      E2E_TIMEOUT,
    );

    test(
      "Non-git directory keeps Attach disabled",
      async () => {
        await page.goto(dashboardUrl);
        await page.waitForTimeout(1000);

        await openRegisterRepositoryDialog(page);
        expect(await waitForOpenDialog(page)).toBe(true);

        const plainName = plainDir.split("/").pop() ?? plainDir;
        await page
          .locator('[data-testid="attach-repo-dir"]', { hasText: plainName })
          .first()
          .click();
        await page.waitForTimeout(500);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "register-03-not-git-repo.png"),
          fullPage: true,
        });

        expect(await page.locator('[data-testid="attach-repo-git-badge"]').count()).toBe(0);
        expect(await page.locator('[data-testid="attach-repo-confirm"]').isEnabled()).toBe(false);
      },
      E2E_TIMEOUT,
    );
  });

  describe("unhappy path", () => {
    let blockedRepo: TempRepoResult;
    let blockedTaskId: string;

    beforeAll(async () => {
      blockedRepo = await createTempRepo("dashboard-blocked-e2e", ctx.reposDir);
    }, E2E_TIMEOUT);

    afterAll(async () => {
      if (blockedRepo) await blockedRepo.cleanup(ctx.env);
    }, E2E_TIMEOUT);

    test(
      "13.2.1 - BLOCKED task shows its status in task detail",
      async () => {
        await copyFixture("blocked-test", blockedRepo.path);
        await Bun.$`git add .`.cwd(blockedRepo.path).quiet();
        await Bun.$`git commit -m "Add blocked fixture"`.cwd(blockedRepo.path).quiet();

        const { exitCode } = await runAopCommand(
          ["repo:init", blockedRepo.path],
          undefined,
          ctx.env,
        );
        expect(exitCode).toBe(0);

        await triggerServerRefresh(ctx.localServerUrl);
        await Bun.sleep(1000);

        const { exitCode: statusExit, stdout } = await runAopCommand(
          ["status", join(blockedRepo.path, "docs/tasks/blocked-test"), "--json"],
          undefined,
          ctx.env,
        );
        expect(statusExit).toBe(0);

        const task = JSON.parse(stdout);
        expect(task.status).toBe("DRAFT");
        blockedTaskId = task.id;

        const statusSet = await setTaskStatus(blockedTaskId, "BLOCKED", ctx.localServerUrl);
        expect(statusSet).toBe(true);

        const blockedTask = await waitForTask(blockedTaskId, ["BLOCKED"], {
          timeout: 10_000,
          pollInterval: 1000,
          localServerUrl: ctx.localServerUrl,
        });
        expect(blockedTask).not.toBeNull();
        expect(blockedTask?.status).toBe("BLOCKED");

        await openTaskDetail(page, blockedTaskId, dashboardUrl);
        const badge = page.getByTestId("task-status-badge");
        await badge.waitFor({ state: "visible", timeout: 10_000 });
        expect((await badge.textContent()) ?? "").toContain("Needs you");

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "09-task-blocked.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.2.2 - Verify task is REMOVED via Remove action in task detail",
      async () => {
        await openTaskDetail(page, blockedTaskId, dashboardUrl);

        // Risky actions (Reset/Block/Remove) live in the task-detail overflow menu.
        await page.locator('[data-testid="task-actions-menu-button"]').click();
        const removeButton = page.locator('[data-testid="remove-task-button"]');
        await removeButton.waitFor({ state: "visible", timeout: 5_000 });
        expect(await removeButton.isVisible()).toBe(true);

        await removeButton.click();
        const confirmButton = getOpenDialog(page).getByRole("button", { name: /^Remove$/ });
        await confirmButton.waitFor({ state: "visible", timeout: 5_000 });
        await confirmButton.click();
        await page.waitForTimeout(2000);

        const removedTask = await waitForTask(blockedTaskId, ["REMOVED"], {
          timeout: 10_000,
          pollInterval: 1000,
          localServerUrl: ctx.localServerUrl,
        });
        expect(removedTask?.status).toBe("REMOVED");

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "10-task-removed.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.2.3 - Verify task can be ABORTED while WORKING (force remove)",
      async () => {
        const abortRepo = await createTempRepo("dashboard-abort-e2e", ctx.reposDir);

        try {
          await copyFixture("backlog-test", abortRepo.path);
          await Bun.$`git add .`.cwd(abortRepo.path).quiet();
          await Bun.$`git commit -m "Add fixture for abort test"`.cwd(abortRepo.path).quiet();

          const { exitCode } = await runAopCommand(
            ["repo:init", abortRepo.path],
            undefined,
            ctx.env,
          );
          expect(exitCode).toBe(0);

          await triggerServerRefresh(ctx.localServerUrl);
          await Bun.sleep(2000);

          const { exitCode: statusExit, stdout } = await runAopCommand(
            ["status", join(abortRepo.path, "docs/tasks/backlog-test"), "--json"],
            undefined,
            ctx.env,
          );
          expect(statusExit).toBe(0);

          const task = JSON.parse(stdout);
          const abortTaskId = task.id;
          const abortStatus = await getFullStatus(ctx.env);
          const abortRepoStatus = abortStatus?.repos.find((entry) => entry.path === abortRepo.path);
          expect(abortRepoStatus).toBeTruthy();
          if (!abortRepoStatus) throw new Error("Abort test repository was not registered");
          await ensureWorkflowsReady(ctx.localServerUrl);
          const abortWorkerId = await createE2EWorker(ctx.localServerUrl, [abortRepoStatus.id]);
          await assignTaskToWorker(
            ctx.localServerUrl,
            abortRepoStatus.id,
            abortTaskId,
            abortWorkerId,
          );

          const { exitCode: readyExit } = await runAopCommand(
            ["task:ready", abortTaskId],
            undefined,
            ctx.env,
          );
          expect(readyExit).toBe(0);

          const workingTask = await waitForTask(abortTaskId, ["WORKING"], {
            timeout: 60_000,
            pollInterval: 1000,
            localServerUrl: ctx.localServerUrl,
          });
          expect(workingTask).not.toBeNull();

          await page.screenshot({
            path: join(SCREENSHOT_DIR, "11-task-working-before-abort.png"),
            fullPage: true,
          });

          await openTaskDetail(page, abortTaskId, dashboardUrl);

          // Risky actions (Reset/Block/Remove) live in the task-detail overflow menu.
          await page.locator('[data-testid="task-actions-menu-button"]').click();
          const removeButton = page.locator('[data-testid="remove-task-button"]');
          await removeButton.waitFor({ state: "visible", timeout: 5_000 });
          await removeButton.click();

          const confirmButton = getOpenDialog(page).getByRole("button", { name: /^Remove$/ });
          await confirmButton.waitFor({ state: "visible", timeout: 5000 });
          await confirmButton.click();

          await page.waitForTimeout(3000);

          const abortedTask = await waitForTask(abortTaskId, ["REMOVED"], {
            timeout: 30_000,
            pollInterval: 1000,
            localServerUrl: ctx.localServerUrl,
          });
          expect(abortedTask?.status).toBe("REMOVED");

          await page.screenshot({
            path: join(SCREENSHOT_DIR, "12-task-aborted.png"),
            fullPage: true,
          });
        } finally {
          await abortRepo.cleanup(ctx.env);
        }
      },
      E2E_TIMEOUT,
    );
  });
});
