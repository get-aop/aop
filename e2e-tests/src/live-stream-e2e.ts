/**
 * FULL-STACK live streaming test: boots the real local server (from this
 * worktree) with a seeded pi/DeepSeek runtime config, starts the real dashboard
 * dev server, drives a REAL pi CLI run, and watches the live chat row in
 * Chromium — measuring visible-text blinks, paragraph structure, and reveal lag.
 *
 * Usage: bun e2e-tests/src/live-stream-e2e.ts
 * Requires: pi CLI with a deepseek provider configured in ~/.pi (user's real
 * config — this test drives the REAL model, no fixtures).
 */
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dir, "..", "..");
const HOME = "/tmp/aop-live-test-home";
const REPO = "/tmp/aop-live-test-repo";
const DB_PATH = join(HOME, "aop.sqlite");
const SERVER_PORT = 48211;
const DASHBOARD_PORT = 47321;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });
rmSync(REPO, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });

// 1. Seed the runtime configuration: pi provider first, deepseek model default.
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS runtime_configuration_providers (
    id text primary key, name text not null, command text not null,
    driver text not null, built_in integer default 0 not null,
    created_at text default (datetime('now')) not null,
    updated_at text default (datetime('now')) not null,
    position integer NOT NULL DEFAULT 0,
    supports_fast_mode integer NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS runtime_configuration_models (
    id text primary key, provider_id text not null, description text not null,
    model text not null, thinking_levels text not null,
    fast_mode integer default 0 not null, built_in integer default 0 not null,
    created_at text default (datetime('now')) not null,
    updated_at text default (datetime('now')) not null,
    position integer NOT NULL DEFAULT 0,
    is_default integer NOT NULL DEFAULT 0,
    default_thinking_level text
  );
  INSERT INTO runtime_configuration_providers (id, name, command, driver, built_in, position)
    VALUES ('pi', 'PI', 'pi', 'pi', 1, 0);
  INSERT INTO runtime_configuration_models
    (id, provider_id, description, model, thinking_levels, position, is_default, default_thinking_level)
    VALUES ('m_deepseek', 'pi', 'DeepSeek V4 Flash', 'opencode-go/deepseek-v4-flash',
            '["low","medium","high","max"]', 0, 1, 'max');
`);
db.close();

// 2. Temp git repo for the session workspace.
const gitInit = await Bun.$`git init -q -b main ${REPO}`.quiet().catch(() => {});
if (gitInit && gitInit.exitCode !== 0) {
  console.error("git init failed:", gitInit.stderr.toString());
  process.exit(1);
}
await Bun.write(join(REPO, "README.md"), "# Live Test Repo\n");
const gitCommit =
  await Bun.$`cd ${REPO} && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main`;
if (gitCommit.exitCode !== 0) {
  console.error("git commit failed:", gitCommit.stderr.toString());
  process.exit(1);
}

// 3. Start the local server.
const server = Bun.spawn({
  cmd: [process.execPath, join(ROOT, "apps/local-server/src/run.ts")],
  env: {
    ...process.env,
    AOP_HOME: HOME,
    AOP_DB_PATH: DB_PATH,
    AOP_LOCAL_SERVER_PORT: String(SERVER_PORT),
    AOP_TEST_MODE: "true",
  },
  stdout: "pipe",
  stderr: "pipe",
});
const serverLog = (async () => {
  const reader = new Response(server.stdout).text();
  const readerErr = new Response(server.stderr).text();
  const [out, err] = await Promise.all([reader, readerErr]);
  return `${out}\n${err}`;
})();

const waitForServer = async (): Promise<boolean> => {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${SERVER_URL}/api/status`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  return false;
};
if (!(await waitForServer())) {
  console.error("local server failed to start:\n", await serverLog);
  server.kill();
  process.exit(1);
}
console.log("local server up at", SERVER_URL);

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${SERVER_URL}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `${init?.method ?? "GET"} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`,
    );
  return body as Record<string, unknown>;
};

// The server's migrations seed built-in providers lazily on first list();
// trigger that seeding, then reorder so pi+deepseek win the defaults.
// The server's migrations seed built-in providers lazily on first list();
// trigger that seeding, then reorder so pi+deepseek win the defaults.
await json("/api/runtime-configuration");
for (let attempt = 0; attempt < 10; attempt += 1) {
  const db = new Database(DB_PATH);
  db.exec(`
    UPDATE runtime_configuration_providers SET position = 100 WHERE id != 'pi';
    UPDATE runtime_configuration_providers SET position = 0 WHERE id = 'pi';
    UPDATE runtime_configuration_models SET position = 100 WHERE provider_id = 'pi' AND model != 'opencode-go/deepseek-v4-flash';
    UPDATE runtime_configuration_models SET position = 0, is_default = 1 WHERE provider_id = 'pi' AND model = 'opencode-go/deepseek-v4-flash';
    INSERT OR IGNORE INTO runtime_configuration_models
      (id, provider_id, description, model, thinking_levels, position, is_default, default_thinking_level)
      VALUES ('m_deepseek', 'pi', 'DeepSeek V4 Flash', 'opencode-go/deepseek-v4-flash',
              '["low","medium","high","max"]', 0, 1, 'max');
  `);
  db.close();
  await Bun.sleep(300);
}
{
  const db = new Database(DB_PATH);
  const order = db
    .query("SELECT id, position FROM runtime_configuration_providers ORDER BY position")
    .all();
  console.log("provider order:", JSON.stringify(order));
  const models = db
    .query(
      "SELECT provider_id, model, position FROM runtime_configuration_models WHERE provider_id = 'pi' ORDER BY position",
    )
    .all();
  console.log("pi models:", JSON.stringify(models.slice(0, 3)));
  db.close();
}

// 4. Register repo + create session + send a message.
const repo = await json("/api/repos", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ path: REPO }),
});
const repoId = (repo as { repoId?: string }).repoId;
console.log("repo:", repoId);

const created = await json("/api/chat-sessions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ repoId }),
});
const session = (created as { session?: { id?: string } }).session ?? (created as { id?: string });
const sessionId = session.id as string;
console.log("session:", sessionId, "runtime:", session.runtime, "model:", session.model);

// 5. Start the dashboard dev server.
const dashboard = Bun.spawn({
  cmd: [process.execPath, "dev.ts"],
  cwd: join(ROOT, "apps/dashboard"),
  env: {
    ...process.env,
    API_URL: SERVER_URL,
    AOP_DASHBOARD_PORT: String(DASHBOARD_PORT),
    AOP_LOCAL_SERVER_URL: SERVER_URL,
  },
  stdout: "pipe",
  stderr: "pipe",
});
const dashboardLog = (async () => {
  const [out, err] = await Promise.all([
    new Response(dashboard.stdout).text(),
    new Response(dashboard.stderr).text(),
  ]);
  return `${out}\n${err}`;
})();
let dashboardUp = false;
for (let i = 0; i < 120; i += 1) {
  try {
    const res = await fetch(`http://localhost:${DASHBOARD_PORT}/`);
    if (res.ok) {
      dashboardUp = true;
      break;
    }
  } catch {
    // not up yet
  }
  await Bun.sleep(500);
}
if (!dashboardUp) {
  console.error("dashboard failed to start:\n", await dashboardLog);
  server.kill();
  process.exit(1);
}
console.log("dashboard up at", `http://localhost:${DASHBOARD_PORT}`);

// 6. Playwright: open the dashboard FIRST and select the session, so the watch
// loop is live before the message is sent.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("PAGE CONSOLE ERROR:", m.text().slice(0, 200));
});
await page.goto(`http://localhost:${DASHBOARD_PORT}/`);
await page.waitForSelector('[data-testid="chat-thread"]', { timeout: 30_000 }).catch(() => {});
await page.evaluate((sid) => {
  sessionStorage.setItem("aop.sessions.activeId", sid);
}, sessionId);
await page.reload();
await page.waitForSelector('[data-testid="chat-thread"]', { timeout: 30_000 }).catch(() => {});

// 7. Send a real message (drives pi CLI + deepseek) AFTER the page is watching.
const sent = await json(`/api/chat-sessions/${sessionId}/messages`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    content:
      "Explore this repo: read README.md, run `git log --oneline -5` and `git status`, then write a short summary.md file with what you found, and finally tell me what the repo is about. Explain your reasoning at each step.",
  }),
});
console.log("message sent:", (sent as { message?: { id?: string } }).message?.id);

// Watch loop: sample the live row every 100ms, detect blinks, take screenshots.
const blinks: Array<{ t: number; kind: string; before: number; after: number }> = [];
const samples: Array<{
  t: number;
  thinking: number;
  content: number;
  thinkingText: string;
  contentText: string;
  thinkingParagraphs: number;
}> = [];
let lastT = 0;
let lastC = 0;
let lastTText = "";
let lastCText = "";
let shots = 0;
let shotFrames = 0;
const started = Date.now();
let done = false;
while (!done && Date.now() - started < 240_000) {
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => {
    const thinkingEl = document.querySelector('[data-testid="assistant-thinking"]');
    const contentEl = document.querySelector('[data-testid="assistant-stream-content"]');
    const typing = document.querySelector('[data-testid="chat-stream-activity"]') !== null;
    const scroller = document.querySelector('[data-slot="message-scroller"]');
    return {
      typing,
      thinking: thinkingEl?.textContent ?? "",
      content: contentEl?.textContent ?? "",
      paragraphs: thinkingEl?.querySelectorAll("p").length ?? 0,
      activity: document.querySelector('[data-testid="chat-stream-activity"]') !== null,
      liveRow: document.querySelector('[data-message-id="streaming-assistant"]') !== null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
    };
  });
  const t = state.thinking.length;
  const c = state.content.length;
  if (t < lastT) {
    blinks.push({ t: Date.now() - started, kind: "thinking-shrink", before: lastT, after: t });
    await page
      .screenshot({ path: `/tmp/live-blink-t${String(Date.now() - started).padStart(6, "0")}.png` })
      .catch(() => {});
  }
  if (Date.now() - started > 9000 && shotFrames++ % 8 === 0) {
    await page
      .screenshot({ path: `/tmp/live-seq-${String(Date.now() - started).padStart(6, "0")}.png` })
      .catch(() => {});
  } else if (t > 0 && lastTText && !state.thinking.startsWith(lastTText)) {
    blinks.push({ t: Date.now() - started, kind: "thinking-replace", before: lastT, after: t });
  }
  if (c < lastC) {
    blinks.push({ t: Date.now() - started, kind: "content-shrink", before: lastC, after: c });
    await page.screenshot({
      path: `/tmp/live-blink-c${String(Date.now() - started).padStart(6, "0")}.png`,
    });
  } else if (c > 0 && lastCText && !state.content.startsWith(lastCText)) {
    blinks.push({ t: Date.now() - started, kind: "content-replace", before: lastC, after: c });
  }
  lastT = t;
  lastC = c;
  lastTText = state.thinking;
  lastCText = state.content;
  samples.push({
    t: Date.now() - started,
    thinking: t,
    content: c,
    thinkingText: state.thinking.slice(-100),
    contentText: state.content.slice(-100),
    thinkingParagraphs: state.paragraphs,
    scrollTop: state.scrollTop,
  });
  if (!state.liveRow && (t > 0 || c > 0) && shots < 4) {
    await page.screenshot({ path: `/tmp/live-test-${shots}.png` });
    shots += 1;
  }
  if (!state.liveRow && !state.typing && (t > 0 || c > 0) && !state.activity) {
    done = true;
  }
}
await page.screenshot({ path: "/tmp/live-test-final.png" });
await browser.close();

// 8. Report.
const shrink = blinks.filter((b) => b.kind.includes("shrink"));
const replace = blinks.filter((b) => b.kind.includes("replace"));
console.log("\n=== LIVE TEST REPORT ===");
console.log(
  "blinks: total",
  blinks.length,
  "| shrinks:",
  shrink.length,
  "| replaces:",
  replace.length,
);
for (const b of blinks.slice(0, 20)) console.log("  ", JSON.stringify(b));
console.log("max thinking chars seen:", Math.max(0, ...samples.map((s) => s.thinking)));
console.log("max content chars seen:", Math.max(0, ...samples.map((s) => s.content)));
console.log("max thinking paragraphs:", Math.max(0, ...samples.map((s) => s.thinkingParagraphs)));
console.log("samples:", samples.length);

import { writeFileSync } from "node:fs";

writeFileSync("/tmp/live-samples.json", JSON.stringify(samples, null, 1));
writeFileSync("/tmp/live-blinks.json", JSON.stringify(blinks, null, 1));
server.kill();
dashboard.kill();
process.exit(0);
