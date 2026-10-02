import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Routine, RoutineRun } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";
import { makeRoutine, makeRun } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../ProjectsProvider");
const { RoutinesTab } = await import("./RoutinesTab");

const project = makeProject({ id: "p1", name: "Checkout", repoIds: ["repo_1"] });

let api: ReturnType<typeof mockApi>;
let routines: Routine[];
let runs: RoutineRun[];
let owner: boolean;
let refuse: { status: number; error: string; code: string } | null;
let stub: ReturnType<typeof stubLiveProjects>;

const routinePath = /^\/projects\/p1\/routines\/([^/]+)(\/run|\/runs)?$/;

beforeEach(() => {
  routines = [];
  runs = [];
  owner = true;
  refuse = null;
  api = mockApi((call) => {
    if (call.path === "/auth/me")
      return Response.json(
        owner
          ? { kind: "owner" }
          : {
              kind: "device",
              device: {
                id: "d1",
                name: "Phone",
                createdAt: "2026-06-01T00:00:00.000Z",
                lastSeenAt: null,
              },
            },
      );
    if (call.method === "GET" && call.path === "/projects/p1/routines") {
      return Response.json({
        routines,
        timeZone: "UTC",
        limits: { minIntervalMinutes: 15, maxActive: 10 },
      });
    }
    if (call.path === "/projects/p1/routines/preview") {
      return Response.json({
        description: "Weekdays at 09:00",
        nextRuns: ["2026-06-02T09:00:00.000Z"],
        timeZone: "UTC",
        problem: null,
      });
    }
    if (refuse)
      return Response.json({ error: refuse.error, code: refuse.code }, { status: refuse.status });
    if (call.method === "POST" && call.path === "/projects/p1/routines") {
      const made = makeRoutine({
        id: `rtn_${routines.length + 2}`,
        ...(call.body as Partial<Routine>),
      });
      routines = [...routines, made];
      return Response.json({ routine: made }, { status: 201 });
    }
    const match = call.path.match(routinePath);
    if (!match) return undefined;
    const [, id, rest] = match;
    const routine = routines.find((known) => known.id === id);
    if (!routine) return Response.json({ error: "Routine not found" }, { status: 404 });
    if (rest === "/runs") return Response.json({ runs });
    if (rest === "/run") {
      const run = makeRun({
        id: "rrun_now",
        trigger: "manual",
        status: "running",
        threadId: "thr_9",
      });
      runs = [run, ...runs];
      const updated = { ...routine, lastRun: run };
      routines = routines.map((known) => (known.id === id ? updated : known));
      return Response.json({ routine: updated, run }, { status: 201 });
    }
    if (call.method === "PATCH") {
      const updated = { ...routine, ...(call.body as Partial<Routine>) };
      routines = routines.map((known) => (known.id === id ? updated : known));
      return Response.json({ routine: updated });
    }
    if (call.method === "DELETE") {
      routines = routines.filter((known) => known.id !== id);
      return new Response(null, { status: 204 });
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  api.restore();
});

const renderTab = () => {
  stub = stubLiveProjects(makeState([makeEntry(project)]));
  render(
    <ProjectsProvider live={stub.live}>
      <RoutinesTab project={project} />
    </ProjectsProvider>,
  );
};

const openMenu = async (card: HTMLElement) => {
  fireEvent.pointerDown(within(card).getByTestId("routine-menu"), { button: 0, ctrlKey: false });
  return screen.findByRole("menu");
};

const card = async (name: string) =>
  (await screen.findAllByTestId("routine-card")).find((element) =>
    element.textContent?.includes(name),
  ) as HTMLElement;

describe("the Routines tab", () => {
  test("with no routine, says how to make one and offers the form", async () => {
    renderTab();
    const empty = await screen.findByTestId("routines-empty");
    expect(empty.textContent).toContain(
      "Ask Claude in the chat to put recurring work on a schedule",
    );
    expect(await screen.findByTestId("routine-new-empty")).toBeTruthy();
  });

  test("lists each routine with its schedule in words, its next run and how its last run went", async () => {
    const now = Date.now();
    routines = [
      makeRoutine({
        id: "rtn_a",
        name: "Digest",
        nextRunAt: new Date(now + 3 * 3_600_000 + 61_000).toISOString(),
        lastRun: makeRun({ status: "ok" }),
      }),
      makeRoutine({
        id: "rtn_b",
        name: "Report",
        schedule: { kind: "weekly", days: [5], time: "17:00" },
        enabled: false,
        nextRunAt: null,
        lastRun: makeRun({ status: "failed", reason: "The run failed" }),
      }),
      makeRoutine({
        id: "rtn_c",
        name: "CI watch",
        schedule: { kind: "hourly", every: 1, minute: 0 },
        lastRun: makeRun({ status: "missed" }),
      }),
      makeRoutine({
        id: "rtn_d",
        name: "Triage",
        target: "coordinator",
        lastRun: makeRun({ status: "skipped" }),
      }),
      makeRoutine({ id: "rtn_e", name: "Deps", lastRun: makeRun({ status: "deferred" }) }),
    ];
    renderTab();

    const digest = await card("Digest");
    expect(within(digest).getByTestId("routine-schedule").textContent).toBe("Weekdays at 09:00");
    expect(within(digest).getByTestId("routine-next").textContent).toBe("Next in 3h 1m");
    expect(within(digest).getByTestId("routine-last-status").textContent).toBe("Done");
    const report = await card("Report");
    expect(within(report).getByTestId("routine-schedule").textContent).toBe(
      "Every Friday at 17:00",
    );
    expect(within(report).getByTestId("routine-next").textContent).toBe("Paused");
    expect(within(report).getByTestId("routine-last-status").textContent).toBe("Failed");
    expect(
      (within(report).getByTestId("routine-switch") as HTMLButtonElement).getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
    expect(within(await card("CI watch")).getByTestId("routine-last-status").textContent).toBe(
      "Missed",
    );
    expect(within(await card("Triage")).getByLabelText("Messages the coordinator")).toBeTruthy();
    expect(within(await card("Triage")).getByTestId("routine-last-status").textContent).toBe(
      "Skipped",
    );
    expect(within(await card("Deps")).getByTestId("routine-last-status").textContent).toBe(
      "Waiting for usage limit",
    );
  });

  test("the switch pauses a routine and turns it back on", async () => {
    routines = [makeRoutine()];
    renderTab();
    const digest = await card("Morning digest");
    fireEvent.click(within(digest).getByTestId("routine-switch"));
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: "PATCH", path: "/projects/p1/routines/rtn_1", body: { enabled: false } },
      ]),
    );
    await waitFor(() =>
      expect(within(digest).getByTestId("routine-next").textContent).toBe("Paused"),
    );
  });

  test("Run now starts a run and opens the history with its thread", async () => {
    routines = [makeRoutine()];
    renderTab();
    const digest = await card("Morning digest");
    fireEvent.click(await within(await openMenu(digest)).findByText("Run now"));

    await waitFor(() =>
      expect(api.writes()[0]).toMatchObject({
        method: "POST",
        path: "/projects/p1/routines/rtn_1/run",
      }),
    );
    const history = await screen.findByTestId("routine-history");
    const [run] = within(history).getAllByTestId("routine-run");
    expect(run?.getAttribute("data-status")).toBe("running");
    expect(
      within(run as HTMLElement)
        .getByTestId("routine-run-thread")
        .getAttribute("href"),
    ).toBe("/projects/p1/threads/thr_9");
  });

  test("the history shows each run's status, why, and what it made", async () => {
    routines = [makeRoutine()];
    runs = [
      makeRun({
        id: "r3",
        status: "skipped",
        reason: "The previous run is still working",
        threadId: null,
      }),
      makeRun({
        id: "r2",
        status: "missed",
        reason: "Missed 3 runs while the host was off",
        threadId: null,
      }),
      makeRun({ id: "r1", status: "ok", trigger: "manual", threadId: null, messageId: "smsg_1" }),
    ];
    renderTab();
    fireEvent.click(within(await card("Morning digest")).getByTestId("routine-open"));
    const items = within(await screen.findByTestId("routine-history")).getAllByTestId(
      "routine-run",
    );
    expect(items.map((item) => item.getAttribute("data-status"))).toEqual([
      "skipped",
      "missed",
      "ok",
    ]);
    expect(items[0]?.textContent).toContain("The previous run is still working");
    expect(items[1]?.textContent).toContain("Missed 3 runs while the host was off");
    expect(
      within(items[2] as HTMLElement).getByTestId("routine-run-message").textContent,
    ).toContain("In the chat");
  });

  test("the form refuses an empty routine, then creates one", async () => {
    renderTab();
    fireEvent.click(await screen.findByTestId("routine-new-empty"));
    fireEvent.click(await screen.findByTestId("routine-save"));
    expect((await screen.findByTestId("routine-name-problem")).textContent).toBe(
      "Name is required.",
    );
    expect(screen.getByTestId("routine-prompt-problem").textContent).toBe(
      "What it does is required.",
    );
    expect(api.writes()).toEqual([]);

    fireEvent.change(screen.getByTestId("routine-name"), { target: { value: "Morning digest" } });
    fireEvent.change(screen.getByTestId("routine-prompt"), {
      target: { value: "Summarize new issues" },
    });
    fireEvent.change(screen.getByTestId("routine-time"), { target: { value: "08:30" } });
    expect((await screen.findByTestId("routine-preview")).textContent).toContain(
      "Weekdays at 09:00",
    );
    fireEvent.click(screen.getByTestId("routine-save"));

    await waitFor(() =>
      expect(api.writes().filter((call) => call.path === "/projects/p1/routines")).toEqual([
        {
          method: "POST",
          path: "/projects/p1/routines",
          body: {
            name: "Morning digest",
            prompt: "Summarize new issues",
            schedule: { kind: "weekdays", time: "08:30" },
            target: "thread",
            repoId: "repo_1",
            model: null,
            effort: null,
            catchUp: "skip",
            enabled: true,
          },
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByTestId("routine-form")).toBeNull());
    expect(await card("Morning digest")).toBeTruthy();
  });

  test("the host's refusal shows in the form, which stays open", async () => {
    renderTab();
    fireEvent.click(await screen.findByTestId("routine-new-empty"));
    fireEvent.change(await screen.findByTestId("routine-name"), { target: { value: "x" } });
    fireEvent.change(screen.getByTestId("routine-prompt"), { target: { value: "y" } });
    refuse = {
      status: 409,
      code: "ROUTINE_LIMIT",
      error: "This project already has 10 routines turned on",
    };
    fireEvent.click(screen.getByTestId("routine-save"));
    expect((await screen.findByTestId("routine-form-error")).textContent).toBe(
      "This project already has 10 routines turned on",
    );
    expect(screen.getByTestId("routine-form")).toBeTruthy();
  });

  test("edit saves the change; duplicate makes a paused copy", async () => {
    routines = [makeRoutine()];
    renderTab();
    fireEvent.click(await within(await openMenu(await card("Morning digest"))).findByText("Edit"));
    const name = (await screen.findByTestId("routine-name")) as HTMLInputElement;
    expect(name.value).toBe("Morning digest");
    fireEvent.change(name, { target: { value: "Morning briefing" } });
    fireEvent.click(screen.getByTestId("routine-save"));
    await waitFor(() =>
      expect(api.writes()[0]).toMatchObject({
        method: "PATCH",
        path: "/projects/p1/routines/rtn_1",
        body: { name: "Morning briefing" },
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("routine-form")).toBeNull());

    fireEvent.click(
      await within(await openMenu(await card("Morning briefing"))).findByText("Duplicate"),
    );
    expect(((await screen.findByTestId("routine-name")) as HTMLInputElement).value).toBe(
      "Morning briefing (copy)",
    );
    fireEvent.click(screen.getByTestId("routine-save"));
    await waitFor(() =>
      expect(api.writes()[1]).toMatchObject({
        method: "POST",
        body: { name: "Morning briefing (copy)", enabled: false },
      }),
    );
    expect(await card("Morning briefing (copy)")).toBeTruthy();
  });

  test("delete asks first", async () => {
    routines = [makeRoutine()];
    renderTab();
    fireEvent.click(
      await within(await openMenu(await card("Morning digest"))).findByText("Delete"),
    );
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: "DELETE", path: "/projects/p1/routines/rtn_1", body: undefined },
      ]),
    );
    expect(await screen.findByTestId("routines-empty")).toBeTruthy();
  });

  test("a routine the coordinator makes appears from the stream", async () => {
    renderTab();
    await screen.findByTestId("routines-empty");
    act(() => {
      stub.emit({
        kind: "entry",
        entry: {
          id: 7,
          projectId: "p1",
          type: "routine.upserted",
          payload: { routine: makeRoutine({ name: "Weekly report", createdBy: "coordinator" }) },
        },
      });
    });
    expect(await card("Weekly report")).toBeTruthy();
  });

  test("a paired device sees routines but cannot change them", async () => {
    owner = false;
    routines = [makeRoutine()];
    renderTab();
    const digest = await card("Morning digest");
    expect(await screen.findByTestId("routines-read-only")).toBeTruthy();
    expect(screen.queryByTestId("routine-new")).toBeNull();
    expect(within(digest).queryByTestId("routine-menu")).toBeNull();
    expect((within(digest).getByTestId("routine-switch") as HTMLButtonElement).disabled).toBe(true);
  });
});
