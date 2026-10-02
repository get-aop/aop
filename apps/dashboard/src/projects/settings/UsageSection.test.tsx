import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProjectUsage, ProjectUsageThread } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";
import { EMPTY_USAGE, makeUsage } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../ProjectsProvider");
const { UsageSection } = await import("./UsageSection");

const project = makeProject({ id: "prj_1", name: "Checkout" });

let api: ReturnType<typeof mockApi>;
let answer: (path: string) => Response;
let usage: ProjectUsage;
let copied: string[];

beforeEach(() => {
  window.localStorage.clear();
  usage = makeUsage();
  answer = () => Response.json(usage);
  api = mockApi((call) =>
    call.path.startsWith("/usage/projects/prj_1") ? answer(call.path) : undefined,
  );
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
});

afterEach(() => {
  cleanup();
  api.restore();
});

const renderUsage = () => {
  const stub = stubLiveProjects(makeState([makeEntry(project)]));
  render(
    <ProjectsProvider live={stub.live}>
      <UsageSection project={project} />
    </ProjectsProvider>,
  );
};

const statValue = (testId: string) =>
  within(screen.getByTestId(testId)).getByText((_, element) => element?.tagName === "DD")
    .textContent;

const cell = (row: HTMLElement, name: string) =>
  row.querySelector(`[data-cell="${name}"]`)?.textContent;

const rowIds = () =>
  screen.getAllByTestId("usage-thread-row").map((row) => row.getAttribute("data-thread-id"));

const thread = (overrides: Partial<ProjectUsageThread>): ProjectUsageThread => ({
  ...(makeUsage().threads[0] as ProjectUsageThread),
  ...overrides,
});

describe("UsageSection headline", () => {
  test("shows threads, tokens, cache hit, code changes, coordinator share and cost", async () => {
    renderUsage();
    await screen.findByTestId("usage-summary");

    expect(statValue("usage-stat-threads")).toBe("1");
    expect(statValue("usage-stat-tokens")).toBe("58,415");
    // 54,000 of the 58,210 tokens the model was given (input + cache writes + cache reads).
    expect(statValue("usage-stat-cache-hit")).toBe("93%");
    expect(statValue("usage-stat-code-changes")).toBe("+1,234 −56");
    // 4,215 of 58,415, the same whole percent the coordinator's row shows.
    expect(statValue("usage-stat-coordinator")).toBe("7%");
    expect(statValue("usage-stat-cost")).toBe("$0.17");
  });

  test("code changes read as a dash when the runs changed no line", async () => {
    usage = { ...makeUsage(), codeChanges: { additions: 0, deletions: 0 } };
    renderUsage();
    await screen.findByTestId("usage-summary");
    expect(statValue("usage-stat-code-changes")).toBe("—");
  });

  test("a cost no run reported is not shown as zero", async () => {
    usage = {
      ...makeUsage(),
      totals: { ...makeUsage().totals, costUsd: null },
      threads: makeUsage().threads.map((entry) => ({ ...entry, costUsd: null })),
    };
    renderUsage();
    await screen.findByTestId("usage-summary");

    expect(statValue("usage-stat-cost")).toBe("Not reported");
    expect(cell(screen.getAllByTestId("usage-thread-row")[0] as HTMLElement, "cost")).toBe("–");
  });
});

describe("UsageSection breakdown", () => {
  test("a stacked bar and a keyed list of the four buckets, named by the model", async () => {
    renderUsage();
    await screen.findByTestId("usage-breakdown");

    const parts = screen.getAllByTestId("usage-bar-part");
    expect(parts.map((part) => part.getAttribute("data-part"))).toEqual([
      "input",
      "output",
      "cache-write",
      "cache-read",
    ]);
    // Each segment grows by its tokens, so the bar is the totals in proportion.
    expect(parts.map((part) => part.style.flexGrow)).toEqual(["1010", "205", "3200", "54000"]);
    expect(statValue("usage-part-input")).toBe("1,010");
    expect(statValue("usage-part-output")).toBe("205");
    expect(statValue("usage-part-cache-write")).toBe("3,200");
    expect(statValue("usage-part-cache-read")).toBe("54,000");
    expect(statValue("usage-stat-runs")).toBe("2");
    expect(screen.getByTestId("usage-breakdown-models").textContent).toBe("Opus 5");
    // One model is named over the breakdown, so there is no per-model table.
    expect(screen.queryByTestId("usage-by-model")).toBeNull();
  });

  test("a bucket with no tokens has no segment", async () => {
    usage = { ...makeUsage(), totals: { ...makeUsage().totals, cacheWriteTokens: 0 } };
    renderUsage();
    await screen.findByTestId("usage-breakdown");
    expect(
      screen.getAllByTestId("usage-bar-part").map((part) => part.getAttribute("data-part")),
    ).toEqual(["input", "output", "cache-read"]);
  });

  test("several models get a row each, with their cost", async () => {
    const opus = makeUsage().byModel[0] as ProjectUsage["byModel"][number];
    usage = {
      ...makeUsage(),
      byModel: [
        { ...opus, costUsd: 0.12 },
        { ...opus, model: "claude-haiku-5", costUsd: 0.051525 },
      ],
    };
    renderUsage();
    const rows = await screen.findAllByTestId("usage-model-row");

    expect(rows.map((row) => row.getAttribute("data-model"))).toEqual([
      "claude-opus-5",
      "claude-haiku-5",
    ]);
    expect(rows.map((row) => cell(row, "cost"))).toEqual(["$0.12", "$0.05"]);
  });
});

describe("UsageSection threads", () => {
  test("a row per session: title link, model and age, share bar, tokens, cache hit, share", async () => {
    renderUsage();
    const rows = await screen.findAllByTestId("usage-thread-row");

    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual(["thread", "coordinator"]);
    const [first, coordinator] = rows as [HTMLElement, HTMLElement];
    expect(within(first).getByRole("link").getAttribute("href")).toBe(
      "/projects/prj_1/threads/thr_1",
    );
    expect(cell(first, "title")).toBe("Fix the login redirect");
    expect(cell(first, "when")).toMatch(/^Opus 5 /);
    expect(first.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-30T09:00:00.000Z");
    expect(cell(first, "tokens")).toBe("54,200");
    // 50,000 of the 54,000 tokens the model was given.
    expect(cell(first, "cache-hit")).toBe("93%");
    expect(cell(first, "share")).toBe("93%");
    expect(cell(first, "cost")).toBe("$0.16");
    expect(cell(coordinator, "title")).toBe("Coordinator");
    expect(within(coordinator).queryByRole("link")).toBeNull();
    expect(cell(coordinator, "share")).toBe("7%");
    expect(cell(coordinator, "cost")).toBe("$0.01");
  });

  test("shares add up to 100 and costs to the total, whatever the rounding", async () => {
    const third = { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 1 };
    usage = {
      ...makeUsage(),
      totals: { ...makeUsage().totals, inputTokens: 3, outputTokens: 3, cacheReadTokens: 3 },
      threads: ["a", "b", "c"].map((id) =>
        thread({ threadId: `thr_${id}`, title: id, ...third, costUsd: 0.01 / 3 }),
      ),
    };
    usage.totals = { ...usage.totals, cacheWriteTokens: 0, costUsd: 0.01 };
    renderUsage();
    const rows = await screen.findAllByTestId("usage-thread-row");

    expect(rows.map((row) => cell(row, "share"))).toEqual(["34%", "33%", "33%"]);
    expect(rows.map((row) => cell(row, "cost"))).toEqual(["$0.01", "<$0.01", "<$0.01"]);
  });

  test("sorts by share, cache hit or recency, with the coordinator always last", async () => {
    const coordinator = makeUsage().threads[1] as ProjectUsageThread;
    usage = {
      ...makeUsage(),
      threads: [
        thread({ threadId: "thr_big", title: "Big", cacheReadTokens: 90_000 }),
        thread({
          threadId: "thr_new",
          title: "New",
          cacheReadTokens: 0,
          lastRunAt: "2026-09-30T11:00:00.000Z",
        }),
        thread({ threadId: "thr_cached", title: "Cached", inputTokens: 1, cacheWriteTokens: 1 }),
        { ...coordinator, lastRunAt: "2026-09-30T12:00:00.000Z" },
      ],
    };
    renderUsage();
    await screen.findAllByTestId("usage-thread-row");
    expect(rowIds()).toEqual(["thr_big", "thr_cached", "thr_new", "sess_coord"]);

    const choose = (id: string) => {
      fireEvent.pointerDown(screen.getByTestId("usage-sort"), { button: 0, ctrlKey: false });
      fireEvent.click(screen.getByTestId(`usage-sort-${id}`));
    };
    choose("cache");
    await waitFor(() =>
      expect(rowIds()).toEqual(["thr_cached", "thr_big", "thr_new", "sess_coord"]),
    );
    expect(screen.getByTestId("usage-sort").textContent).toContain("Cache hit");

    choose("recent");
    await waitFor(() =>
      expect(rowIds()).toEqual(["thr_new", "thr_big", "thr_cached", "sess_coord"]),
    );
  });
});

describe("UsageSection copy", () => {
  test("copies the screen as plain text, rows in the order shown", async () => {
    renderUsage();
    await screen.findByTestId("usage-summary");

    fireEvent.click(screen.getByTestId("usage-copy"));

    await waitFor(() => expect(copied).toHaveLength(1));
    const lines = (copied[0] as string).split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "Checkout usage, all time",
      "Threads 1 · Tokens 58,415 · Cache hit 93% · Code changes +1,234 −56 · Coordinator 7% · Cost $0.17",
      "Input 1,010 · Output 205 · Cache write 3,200 · Cache read 54,000 · Runs 2",
      "",
      "Threads, by share:",
    ]);
    expect(lines[5]).toMatch(
      /^- Fix the login redirect \(Opus 5, .+\): 54,200 tokens, 93% cache hit, 93% share, \$0\.16$/,
    );
    expect(lines[6]).toMatch(
      /^- Coordinator \(Opus 5, .+\): 4,215 tokens, 95% cache hit, 7% share/,
    );
    expect(screen.getByTestId("usage-copy").getAttribute("data-copied")).toBe("true");
  });

  test("there is nothing to copy for a window with no usage", async () => {
    usage = EMPTY_USAGE;
    renderUsage();
    await screen.findByTestId("usage-empty");
    expect((screen.getByTestId("usage-copy") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("UsageSection window", () => {
  test("asks for all time first, then for a shorter window when chosen", async () => {
    renderUsage();
    await screen.findByTestId("usage-summary");
    // The Library's storage settings above the usage ask for their own route.
    const usageCalls = api.calls.filter((call) => call.path.startsWith("/usage"));
    expect(usageCalls.map((call) => call.path)).toEqual(["/usage/projects/prj_1"]);
    expect(screen.getByTestId("usage-window-all").getAttribute("aria-pressed")).toBe("true");
    usage = EMPTY_USAGE;

    fireEvent.click(screen.getByTestId("usage-window-7d"));

    await screen.findByTestId("usage-empty");
    const url = new URL(
      `http://x${api.calls.filter((call) => call.path.startsWith("/usage")).at(-1)?.path}`,
    );
    expect(url.pathname).toBe("/usage/projects/prj_1");
    expect([...url.searchParams.keys()]).toEqual(["since"]);
    const daysAgo = (Date.now() - Date.parse(url.searchParams.get("since") as string)) / 86_400_000;
    expect(daysAgo).toBeGreaterThan(6.99);
    expect(daysAgo).toBeLessThan(7.01);
    expect(screen.getByTestId("usage-window-7d").getAttribute("aria-pressed")).toBe("true");
  });

  test("a window with no usage says so instead of showing zeros", async () => {
    usage = EMPTY_USAGE;
    renderUsage();

    expect((await screen.findByTestId("usage-empty")).textContent).toContain(
      "No usage in this window",
    );
    expect(screen.queryByTestId("usage-summary")).toBeNull();
    expect(screen.queryByTestId("usage-by-thread")).toBeNull();
  });

  test("a failed load says why, and Try again asks once more", async () => {
    answer = () => Response.json({ error: "Database is locked" }, { status: 500 });
    renderUsage();
    expect((await screen.findByTestId("usage-error")).textContent).toContain("Database is locked");

    answer = () => Response.json(usage);
    fireEvent.click(screen.getByTestId("usage-retry"));

    await screen.findByTestId("usage-summary");
    expect(screen.queryByTestId("usage-error")).toBeNull();
  });

  test("an answer that arrives late for a window the person left is ignored", async () => {
    const late = Promise.withResolvers<Response>();
    let calls = 0;
    api.restore();
    api = mockApi((call) => {
      if (!call.path.startsWith("/usage/projects/prj_1")) return undefined;
      calls += 1;
      return calls === 1 ? late.promise : Response.json(EMPTY_USAGE);
    });
    renderUsage();
    await waitFor(() => expect(calls).toBe(1));

    fireEvent.click(screen.getByTestId("usage-window-24h"));
    await screen.findByTestId("usage-empty");
    late.resolve(Response.json(makeUsage()));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByTestId("usage-empty")).toBeTruthy();
    expect(screen.queryByTestId("usage-summary")).toBeNull();
  });
});
