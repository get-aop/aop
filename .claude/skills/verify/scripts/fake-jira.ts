#!/usr/bin/env bun
/**
 * A fake Jira site for verifying the Issues tab's Jira source. Point the host at
 * `http://127.0.0.1:<port>` as the site URL. It speaks both flavours:
 *
 * - Cloud: REST v3 with `Basic base64(fixture@example.com:jira_fixture_token)`, ADF bodies,
 *   `/rest/api/3/search/jql` with page tokens (the old `/rest/api/3/search` answers 410).
 * - Data Center: REST v2 with `Bearer jira_pat_fixture`, wiki-markup bodies, startAt pages.
 *
 * Any other credential gets Jira's 401. Data is in jira-fixtures.ts; endpoints in
 * fake-jira-api.ts. Test scenarios are driven over HTTP, no auth needed:
 *
 *   POST /__fixture/revoke | restore          every API request answers 401 until restored
 *   POST /__fixture/rate-limit?count=N&retryAfter=S   the next N API requests answer 429
 *   POST /__fixture/many | few                add or remove 150 old open OPS issues
 *   POST /__fixture/touch                     edit APP-1's summary and bump its updated time
 *   POST /__fixture/slow?ms=4000              delay API answers (ms=0 to stop)
 *   GET  /__fixture/calls                     the request log
 *
 * Every API request is logged to stdout (and appended to --log) without its credentials.
 *
 *   bun .claude/skills/verify/scripts/fake-jira.ts --port 25495 [--log <file>]
 */
import { appendFileSync } from "node:fs";
import { describeInput, jiraError, readInput, routeApi } from "./fake-jira-api.ts";
import {
  FIXTURE_API_TOKEN,
  FIXTURE_EMAIL,
  FIXTURE_PAT,
  ISSUES,
  type IssueSpec,
  type JiraApi,
  manyIssues,
} from "./jira-fixtures.ts";

const flag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const port = Number(flag("--port") ?? 25495);
const logFile = flag("--log");
const base = `http://127.0.0.1:${port}`;

const state = {
  revoked: false,
  limited: 0,
  retryAfter: 2,
  slowMs: 0,
  many: false,
  touches: 0,
  touchedAt: "",
};
const MANY = manyIssues();
const calls: string[] = [];

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__fixture/")) return control(request.method, url);
    const asset = assetFor(url.pathname);
    if (asset) return asset;
    const match = url.pathname.match(/^\/rest\/api\/([23])(\/.*)$/);
    if (!match) return jiraError(404, ["The requested resource could not be found."]);
    const input = await readInput(request, url);
    const response = await answer(
      request,
      match[1] === "3" ? "cloud" : "dc",
      match[2] ?? "/",
      input,
    );
    const summary = [request.method, url.pathname, describeInput(input)].filter(Boolean);
    log(`${summary.join(" ")} -> ${response.status}`);
    return response;
  },
});
process.stdout.write(`fake Jira on ${base}\n`);

async function answer(
  request: Request,
  api: JiraApi,
  path: string,
  input: Awaited<ReturnType<typeof readInput>>,
): Promise<Response> {
  if (state.slowMs > 0) await Bun.sleep(state.slowMs);
  if (state.limited > 0) {
    state.limited--;
    return jiraError(429, ["Rate limit exceeded."], { "Retry-After": String(state.retryAfter) });
  }
  if (state.revoked || !authenticated(request.headers.get("authorization"), api)) {
    return Response.json(
      { errorMessages: ["Client must be authenticated to access this resource."] },
      { status: 401, headers: { "WWW-Authenticate": 'Basic realm="protected-area"' } },
    );
  }
  return routeApi({ base, api, method: request.method, path, input, issues: currentIssues() });
}

function authenticated(header: string | null, api: JiraApi): boolean {
  const [scheme = "", value = ""] = (header ?? "").split(" ");
  if (api === "dc") return scheme.toLowerCase() === "bearer" && value === FIXTURE_PAT;
  if (scheme.toLowerCase() !== "basic") return false;
  try {
    return atob(value) === `${FIXTURE_EMAIL}:${FIXTURE_API_TOKEN}`;
  } catch {
    return false;
  }
}

function currentIssues(): IssueSpec[] {
  const issues = ISSUES.map((spec) =>
    spec.key === "APP-1" && state.touches > 0
      ? {
          ...spec,
          summary: `${spec.summary} (edited ${state.touches})`,
          touchedAt: state.touchedAt,
        }
      : spec,
  );
  return state.many ? [...issues, ...MANY] : issues;
}

const CONTROLS: Record<string, (url: URL) => string> = {
  "POST revoke": () => {
    state.revoked = true;
    return "token revoked: API requests answer 401";
  },
  "POST restore": () => {
    state.revoked = false;
    return "token restored";
  },
  "POST rate-limit": (url) => {
    state.limited = Number(url.searchParams.get("count") ?? 1);
    state.retryAfter = Number(url.searchParams.get("retryAfter") ?? 2);
    return `next ${state.limited} API requests answer 429, Retry-After ${state.retryAfter}`;
  },
  "POST many": () => {
    state.many = true;
    return `OPS has ${MANY.length} extra old open issues`;
  },
  "POST few": () => {
    state.many = false;
    return "extra OPS issues removed";
  },
  "POST touch": () => {
    state.touches++;
    state.touchedAt = new Date().toISOString();
    return `APP-1 edited (${state.touches}) at ${state.touchedAt}`;
  },
  "POST slow": (url) => {
    state.slowMs = Number(url.searchParams.get("ms") ?? 4000);
    return `API answers delayed ${state.slowMs}ms`;
  },
  "GET calls": () => calls.join("\n") + (calls.length > 0 ? "\n" : ""),
};

function control(method: string, url: URL): Response {
  const name = url.pathname.slice("/__fixture/".length);
  const handle = CONTROLS[`${method} ${name}`];
  if (!handle) return new Response(`unknown control ${method} ${name}\n`, { status: 404 });
  const text = handle(url);
  if (name !== "calls") log(`${method} ${url.pathname}${url.search} (control) ${text}`);
  return new Response(name === "calls" ? text : `${text}\n`);
}

function log(line: string): void {
  const entry = `${new Date().toISOString()} ${line}`;
  calls.push(entry);
  process.stdout.write(`${entry}\n`);
  if (logFile) appendFileSync(logFile, `${entry}\n`);
}

// Images the payloads point at on the site itself. Real Jira serves these too; the user avatar
// answers 401 the way a private avatar does to a browser without a session.
function assetFor(path: string): Response | null {
  if (path === "/secure/useravatar") return new Response("Unauthorized", { status: 401 });
  const priority = path.match(/^\/images\/icons\/priorities\/(\w+)\.svg$/);
  if (priority) return svg(PRIORITY_ICONS[priority[1] ?? ""] ?? PRIORITY_ICONS.medium ?? "");
  if (path.startsWith("/images/icons/statuses/")) {
    return svg('<circle cx="8" cy="8" r="5" fill="#8993a4"/>');
  }
  const avatar = path.match(
    /^\/rest\/api\/[23]\/universal_avatar\/view\/type\/\w+\/avatar\/(\d+)$/,
  );
  if (!avatar) return null;
  const color = AVATAR_COLORS[avatar[1] ?? ""] ?? "#6554c0";
  return svg(`<rect width="16" height="16" rx="3" fill="${color}"/>`);
}

const chevron = (y: number, up: boolean, color: string) =>
  `<path d="M3 ${up ? y + 3 : y} L8 ${up ? y : y + 3} L13 ${up ? y + 3 : y}" stroke="${color}" stroke-width="2" fill="none"/>`;

const PRIORITY_ICONS: Record<string, string> = {
  highest: chevron(3, true, "#ff5630") + chevron(8, true, "#ff5630"),
  high: chevron(6, true, "#ff5630"),
  medium: '<path d="M3 6h10M3 10h10" stroke="#ffab00" stroke-width="2"/>',
  low: chevron(6, false, "#0065ff"),
  lowest: chevron(3, false, "#0065ff") + chevron(8, false, "#0065ff"),
};

const AVATAR_COLORS: Record<string, string> = {
  "10303": "#e5493a",
  "10307": "#904ee2",
  "10315": "#63ba3c",
  "10318": "#4bade8",
  "10411": "#00b8d9",
  "10419": "#ff991f",
  "10424": "#36b37e",
};

function svg(shape: string): Response {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${shape}</svg>`,
    { headers: { "content-type": "image/svg+xml", "cache-control": "max-age=3600" } },
  );
}
