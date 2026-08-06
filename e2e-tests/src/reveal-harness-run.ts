/**
 * Drives the live-streaming reveal harness in headless Chromium.
 * Usage: bun e2e-tests/src/reveal-harness-run.ts <events.jsonl> [outdir] [trimToThinkingChars]
 *
 * Replays a real PI/DeepSeek SSE event stream through the real
 * useStreamingReveal + ChatMarkdown components, then reports:
 *  - blink events (visible text shrinking / being replaced)
 *  - paragraph structure of the thinking block while typing
 *  - reveal lag vs the model's output (target - visible)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dir, "..", "..");
const DASHBOARD = join(ROOT, "apps", "dashboard");
const eventsPath = process.argv[2] ?? "/tmp/events.jsonl";
const outDir = process.argv[3] ?? "/tmp/harness-out";
const trimToThinking = Number(process.argv[4] ?? 0);
mkdirSync(outDir, { recursive: true });

const rawEvents = readFileSync(eventsPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// Trim: keep events until accumulated thinking reaches `trimToThinking` chars.
let cumulativeThinking = 0;
const events: Array<{ t: number; type: string; data: Record<string, unknown> }> = [];
let virtualT = 0;
for (const event of rawEvents) {
  virtualT += 100;
  if (event.type === "assistant-progress") {
    const data = event.data as Record<string, unknown>;
    const delta = typeof data.thinking === "string" ? data.thinking.length : 0;
    const replace = data.replace === true;
    if (replace) cumulativeThinking = delta;
    else cumulativeThinking += delta;
  }
  if (event.type === "assistant-final") break; // keep the stream active so the reveal can finish
  events.push({ t: virtualT, type: event.type, data: event.data as Record<string, unknown> });
  if (trimToThinking > 0 && cumulativeThinking >= trimToThinking) break;
}

// 1. Build the harness bundle with the dashboard's own build options.
const buildResult = await Bun.build({
  entrypoints: [join(DASHBOARD, "src", "reveal-harness-entry.tsx")],
  outdir: join(outDir, "bundle"),
  target: "browser",
  format: "esm",
  minify: true,
  splitting: false,
  naming: "reveal-harness-entry.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!buildResult.success) {
  console.error(buildResult.logs);
  process.exit(1);
}

// 2. Minimal page: real chat-markdown CSS + the bundle + the events.
const cssRules = [
  ".chat-markdown{min-width:0;overflow-wrap:anywhere;word-break:break-word}",
  ".chat-markdown> :first-child{margin-top:0}.chat-markdown> :last-child{margin-bottom:0}",
  ".chat-markdown p,.chat-markdown ul,.chat-markdown ol,.chat-markdown blockquote,.chat-markdown pre{margin:0.65rem 0}",
  ".chat-markdown h1,.chat-markdown h2,.chat-markdown h3,.chat-markdown h4,.chat-markdown h5,.chat-markdown h6{margin:1.25rem 0 0.5rem;font-weight:600;line-height:1.3}",
  "body{font-family:ui-sans-serif,system-ui,sans-serif;background:#fff;color:#111;max-width:720px;margin:0 auto;padding:16px}",
  ".text-foreground\\/82{color:#111}",
  ".text-sm{font-size:14px}",
  ".whitespace-pre-wrap{white-space:pre-wrap}",
  ".break-words{overflow-wrap:break-word}",
  ".leading-relaxed{line-height:1.625}",
].join("\n");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${cssRules}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="bundle/reveal-harness-entry.js"></script>
<script type="module">
window.__EVENTS = ${JSON.stringify(events)};
</script>
</body>
</html>`;
writeFileSync(join(outDir, "index.html"), html);

// 3. Serve over http (ESM is CORS-blocked from file://) and drive the replay.
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    try {
      const body = readFileSync(join(outDir, rel));
      const type = rel.endsWith(".js")
        ? "text/javascript"
        : rel.endsWith(".html")
          ? "text/html"
          : "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
});
const baseUrl = `http://localhost:${server.port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 1200 } });
await page.goto(baseUrl);
await page.waitForFunction(
  () => (window as unknown as { __HARNESS_READY?: boolean }).__HARNESS_READY === true,
);

const virtualMsPerFrame = Number(process.env.VIRTUAL_MS_PER_FRAME ?? 300);
await page.evaluate(
  ({ evs, vmpf }: { evs: unknown; vmpf: number }) => {
    (window as unknown as { __HARNESS_BOOT: (c: unknown) => void }).__HARNESS_BOOT({
      events: evs,
      virtualMsPerFrame: vmpf,
      sampleEveryMs: 250,
    });
  },
  { evs: events, vmpf: virtualMsPerFrame },
);

// 4. Screenshot at progress checkpoints while it runs.
const checkpoints = [0.35, 0.7, 1.0];
const shotAt = new Set<number>();
const row = page.locator(".reveal-harness-row");
let stableFrames = 0;
for (let i = 0; i < 3000; i += 1) {
  const progress = await page
    .locator(".reveal-harness")
    .getAttribute("data-typing")
    .catch(() => null);
  const typing = progress !== "true";
  if (typing) stableFrames += 1;
  else stableFrames = 0;
  // screenshots by accumulated event fraction: use visible length from samples
  const done = typing && stableFrames > 5;
  for (const cp of checkpoints) {
    if (!shotAt.has(cp) && i >= cp * 200) {
      shotAt.add(cp);
      await row
        .screenshot({ path: join(outDir, `shot-${String(cp).replace(".", "")}.png`) })
        .catch(() => {});
    }
  }
  if (done) break;
  await page.waitForTimeout(60);
}

await row.screenshot({ path: join(outDir, "shot-final.png") }).catch(() => {});
const harnessResult = await page.evaluate(() =>
  (window as unknown as { __HARNESS_RESULT: () => unknown }).__HARNESS_RESULT(),
);
writeFileSync(join(outDir, "result.json"), JSON.stringify(harnessResult, null, 2));
await browser.close();
server.stop(true);

// 5. Analysis report.
const typed = harnessResult as {
  samples: Array<{
    t: number;
    targetThinking: number;
    targetContent: number;
    visibleThinking: number;
    visibleContent: number;
    thinkingParagraphs: number;
    contentParagraphs: number;
  }>;
  blinks: Array<{ t: number; kind: string; before: number; after: number }>;
};
console.log("=== BLINKS (visible text shrank or was replaced) ===");
console.log(typed.blinks.length === 0 ? "none" : JSON.stringify(typed.blinks, null, 1));
console.log("=== THINKING PARAGRAPHS while typing ===");
const paraCounts = typed.samples.map((s) => s.thinkingParagraphs);
console.log("max:", Math.max(0, ...paraCounts), "distinct:", [...new Set(paraCounts)].join(","));
console.log("=== REVEAL LAG (target - visible) ===");
const lags = typed.samples.map((s) => s.targetThinking - s.visibleThinking);
console.log("max lag (chars):", Math.max(0, ...lags));
const last = typed.samples[typed.samples.length - 1];
console.log(
  `final: targetThinking=${last?.targetThinking} visibleThinking=${last?.visibleThinking} targetContent=${last?.targetContent} visibleContent=${last?.visibleContent}`,
);
console.log("samples:", typed.samples.length, "blinks:", typed.blinks.length);
console.log("outputs in", outDir);
