import { afterEach, describe, expect, test } from "bun:test";
import type { ThreadStep } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ThreadProgress } = await import("./ThreadProgress");

afterEach(cleanup);

const STEPS: ThreadStep[] = [
  { label: "Reproduce", state: "done" },
  { label: "Bisect", state: "active" },
  { label: "Fix", state: "pending" },
];

describe("the status line", () => {
  test.each(["working", "landing"] as const)("is shown while the thread is %s", (status) => {
    render(
      <ThreadProgress
        thread={makeThread({ status, liveStatusLine: "Bisecting · 7 commits left" })}
      />,
    );

    expect(screen.getByTestId("thread-progress-line").textContent).toBe(
      "Bisecting · 7 commits left",
    );
  });

  test.each([
    "idle",
    "waiting-on-you",
    "ready-for-review",
    "resolved",
    "queued",
    "rate-limited",
  ] as const)(
    "is hidden while the thread is %s: the transcript or a notice of its own says it better",
    (status) => {
      const { container } = render(
        <ThreadProgress thread={makeThread({ status, liveStatusLine: "Fake reply for turn 2" })} />,
      );

      expect(screen.queryByTestId("thread-progress-line")).toBeNull();
      expect(container.textContent).toBe("");
    },
  );

  test("a hidden line still leaves the checklist, headed 'Steps'", () => {
    render(
      <ThreadProgress
        thread={makeThread({ status: "idle", liveStatusLine: "old line", steps: STEPS })}
      />,
    );

    expect(screen.queryByTestId("thread-progress-line")).toBeNull();
    expect(screen.getByTestId("thread-progress-toggle").textContent).toContain("Steps");
    expect(screen.getAllByTestId("thread-step")).toHaveLength(3);
  });
});

describe("the checklist", () => {
  test("lists each step in order with its state, and the ring says how many are done", () => {
    render(<ThreadProgress thread={makeThread({ status: "working", steps: STEPS })} />);

    const steps = screen.getAllByTestId("thread-step");
    expect(steps.map((step) => [step.textContent, step.getAttribute("data-state")])).toEqual([
      ["Reproduce", "done"],
      ["Bisect", "active"],
      ["Fix", "pending"],
    ]);
    const ring = screen.getByTestId("thread-steps");
    expect(ring.getAttribute("data-done")).toBe("1");
    expect(ring.getAttribute("data-total")).toBe("3");
    expect(ring.textContent).toBe("1/3");
  });

  test("a done step is marked with a check and the others are not", () => {
    render(<ThreadProgress thread={makeThread({ status: "working", steps: STEPS })} />);

    const [done, active, pending] = screen.getAllByTestId("thread-step");
    expect(done?.querySelector("svg")).not.toBeNull();
    expect(active?.querySelector("svg")).toBeNull();
    expect(pending?.querySelector("svg")).toBeNull();
  });

  test("only the active step of a working thread pulses", () => {
    const { rerender } = render(
      <ThreadProgress thread={makeThread({ status: "working", steps: STEPS })} />,
    );
    const pulsing = () => document.querySelectorAll(".aop-running-dot").length;
    expect(pulsing()).toBe(1);

    rerender(<ThreadProgress thread={makeThread({ status: "idle", steps: STEPS })} />);
    expect(pulsing()).toBe(0);
  });

  test("a label the checklist repeats gets a row of its own each time", () => {
    const repeated: ThreadStep[] = [
      { label: "Run the tests", state: "done" },
      { label: "Fix", state: "done" },
      { label: "Run the tests", state: "active" },
      { label: "Run the tests", state: "pending" },
    ];
    render(<ThreadProgress thread={makeThread({ status: "working", steps: repeated })} />);

    const rows = screen.getAllByTestId("thread-step");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Run the tests",
      "Fix",
      "Run the tests",
      "Run the tests",
    ]);
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual([
      "done",
      "done",
      "active",
      "pending",
    ]);
  });

  test("a step that changes state changes its row in place", () => {
    const { rerender } = render(
      <ThreadProgress thread={makeThread({ status: "working", steps: STEPS })} />,
    );
    const bisect = within(screen.getAllByTestId("thread-step")[1] as HTMLElement).getByText(
      "Bisect",
    ).parentElement as HTMLElement;

    rerender(
      <ThreadProgress
        thread={makeThread({
          status: "working",
          steps: [
            { label: "Reproduce", state: "done" },
            { label: "Bisect", state: "done" },
            { label: "Fix", state: "active" },
          ],
        })}
      />,
    );

    expect(screen.getAllByTestId("thread-step")[1]).toBe(bisect);
    expect(bisect.getAttribute("data-state")).toBe("done");
    expect(screen.getByTestId("thread-steps").textContent).toBe("2/3");
  });

  test("folds away with the toggle and opens again", () => {
    render(<ThreadProgress thread={makeThread({ status: "working", steps: STEPS })} />);
    expect(screen.getByTestId("thread-steps-list")).toBeTruthy();

    fireEvent.click(screen.getByTestId("thread-progress-toggle"));
    expect(screen.queryByTestId("thread-steps-list")).toBeNull();
    // The ring stays in the folded header: the fraction is the point of folding it.
    expect(screen.getByTestId("thread-steps").textContent).toBe("1/3");

    fireEvent.click(screen.getByTestId("thread-progress-toggle"));
    expect(screen.getAllByTestId("thread-step")).toHaveLength(3);
  });

  test("a thread with only a line shows the line and no checklist or ring", () => {
    render(
      <ThreadProgress
        thread={makeThread({ status: "working", liveStatusLine: "Reading the logs" })}
      />,
    );

    expect(screen.getByTestId("thread-progress-line").textContent).toBe("Reading the logs");
    expect(screen.queryByTestId("thread-steps")).toBeNull();
    expect(screen.queryByTestId("thread-steps-list")).toBeNull();
  });

  test("nothing is drawn with no steps and no line to show", () => {
    const { container } = render(<ThreadProgress thread={makeThread({ status: "working" })} />);

    expect(screen.queryByTestId("thread-progress")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
