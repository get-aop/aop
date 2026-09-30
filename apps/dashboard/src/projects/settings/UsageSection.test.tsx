import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProjectUsage } from "@aop/common";
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

beforeEach(() => {
  window.localStorage.clear();
  usage = makeUsage();
  answer = () => Response.json(usage);
  api = mockApi((call) =>
    call.path.startsWith("/usage/projects/prj_1") ? answer(call.path) : undefined,
  );
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

describe("UsageSection totals", () => {
  test("shows threads, tokens, cache hit, coordinator share and cost from the host's totals", async () => {
    renderUsage();
    await screen.findByTestId("usage-summary");

    expect(statValue("usage-stat-threads")).toBe("1");
    expect(statValue("usage-stat-tokens")).toBe("58,415");
    expect(screen.getByTestId("usage-stat-tokens").textContent).toContain("2 runs");
    // 54,000 of the 58,210 tokens the model was given (input + cache writes + cache reads).
    expect(statValue("usage-stat-cache-hit")).toBe("93%");
    // 4,215 of 58,415.
    expect(statValue("usage-stat-coordinator")).toBe("7%");
    expect(statValue("usage-stat-cost")).toBe("$0.17");
    expect(statValue("usage-stat-input")).toBe("1,010");
    expect(statValue("usage-stat-output")).toBe("205");
    expect(statValue("usage-stat-cache-write")).toBe("3,200");
    expect(statValue("usage-stat-cache-read")).toBe("54,000");
  });

  test("asks for all time first, with no bounds", async () => {
    renderUsage();
    await screen.findByTestId("usage-summary");
    expect(api.calls.map((call) => call.path)).toEqual(["/usage/projects/prj_1"]);
    expect(screen.getByTestId("usage-window-all").getAttribute("aria-pressed")).toBe("true");
  });

  test("a cost no run reported is not shown as zero", async () => {
    usage = {
      ...makeUsage(),
      totals: { ...makeUsage().totals, costUsd: null },
      threads: makeUsage().threads.map((thread) => ({ ...thread, costUsd: null })),
      byModel: makeUsage().byModel.map((model) => ({ ...model, costUsd: null })),
    };
    renderUsage();
    await screen.findByTestId("usage-summary");

    expect(statValue("usage-stat-cost")).toBe("Not reported");
    const row = screen.getAllByTestId("usage-thread-row")[0] as HTMLElement;
    expect(row.querySelector('[data-cell="cost"]')?.textContent).toBe("–");
  });
});

describe("UsageSection breakdowns", () => {
  test("lists a row per model with its four buckets", async () => {
    renderUsage();
    const row = await screen.findByTestId("usage-model-row");

    expect(row.getAttribute("data-model")).toBe("claude-opus-5");
    expect(row.textContent).toContain("Opus 5");
    const cell = (name: string) => row.querySelector(`[data-cell="${name}"]`)?.textContent;
    expect(cell("input")).toBe("1,010");
    expect(cell("output")).toBe("205");
    expect(cell("cache-write")).toBe("3,200");
    expect(cell("cache-read")).toBe("54,000");
    expect(cell("cost")).toBe("$0.17");
  });

  test("lists the coordinator and each thread with tokens and share, biggest first", async () => {
    renderUsage();
    const rows = await screen.findAllByTestId("usage-thread-row");

    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual(["thread", "coordinator"]);
    const thread = rows[0] as HTMLElement;
    expect(thread.textContent).toContain("Fix the login redirect");
    expect(thread.querySelector('[data-cell="tokens"]')?.textContent).toBe("54,200");
    expect(thread.querySelector('[data-cell="share"]')?.textContent).toBe("93%");
    const coordinator = rows[1] as HTMLElement;
    expect(coordinator.textContent).toContain("Coordinator");
    expect(coordinator.querySelector('[data-cell="tokens"]')?.textContent).toBe("4,215");
    expect(coordinator.querySelector('[data-cell="cost"]')?.textContent).toBe("$0.01");
  });

  test("a thread row links to the thread", async () => {
    renderUsage();
    const link = within(
      (await screen.findAllByTestId("usage-thread-row"))[0] as HTMLElement,
    ).getByRole("link");
    expect(link.getAttribute("href")).toBe("/projects/prj_1/threads/thr_1");
  });
});

describe("UsageSection window", () => {
  test("choosing a shorter window asks the host for it and shows that answer", async () => {
    renderUsage();
    await screen.findByTestId("usage-summary");
    usage = EMPTY_USAGE;

    fireEvent.click(screen.getByTestId("usage-window-7d"));

    await screen.findByTestId("usage-empty");
    const last = api.calls.at(-1);
    const url = new URL(`http://x${last?.path}`);
    expect(url.pathname).toBe("/usage/projects/prj_1");
    expect([...url.searchParams.keys()]).toEqual(["since"]);
    const since = url.searchParams.get("since") as string;
    const daysAgo = (Date.now() - Date.parse(since)) / 86_400_000;
    expect(daysAgo).toBeGreaterThan(6.99);
    expect(daysAgo).toBeLessThan(7.01);
    expect(screen.getByTestId("usage-window-7d").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("usage-window-all").getAttribute("aria-pressed")).toBe("false");
  });

  test("a window with no usage says so instead of showing zeros", async () => {
    usage = EMPTY_USAGE;
    renderUsage();

    expect((await screen.findByTestId("usage-empty")).textContent).toContain(
      "No usage in this window",
    );
    expect(screen.queryByTestId("usage-summary")).toBeNull();
    expect(screen.queryByTestId("usage-by-model")).toBeNull();
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
