import { afterEach, describe, expect, test } from "bun:test";
import type { ActivityRow, ThreadTurnActivity } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { WorkLog } = await import("./WorkLog");

afterEach(cleanup);

const row = (id: string, label: string, overrides: Partial<ActivityRow> = {}): ActivityRow => ({
  id,
  label,
  detail: null,
  status: "done",
  ...overrides,
});

const turn = (overrides: Partial<ThreadTurnActivity> = {}): ThreadTurnActivity => ({
  messageId: "msg_1",
  running: false,
  narration: "",
  groups: [],
  ...overrides,
});

const summary = () => screen.getByTestId("work-log-summary").textContent;
const open = () => fireEvent.click(screen.getByTestId("work-log-toggle"));

describe("the folded line", () => {
  test("counts the tool calls of all groups", () => {
    render(
      <WorkLog
        turn={turn({
          groups: [
            { id: "g1", rows: [row("a", "Bash"), row("b", "Read")] },
            { id: "g2", rows: [row("c", "Edit")] },
          ],
        })}
      />,
    );

    expect(summary()).toBe("3 tool calls");
  });

  test("says '1 tool call' in the singular", () => {
    render(<WorkLog turn={turn({ groups: [{ id: "g", rows: [row("a", "Bash")] }] })} />);

    expect(summary()).toBe("1 tool call");
  });

  test("a turn with narration and no tool calls is just 'Worked'", () => {
    render(<WorkLog turn={turn({ narration: "Thinking it over." })} />);

    expect(summary()).toBe("Worked");
  });

  test("says how many calls failed", () => {
    render(
      <WorkLog
        turn={turn({
          groups: [
            {
              id: "g",
              rows: [
                row("a", "Bash", { status: "failed" }),
                row("b", "Read"),
                row("c", "Bash", { status: "failed" }),
              ],
            },
          ],
        })}
      />,
    );

    expect(summary()).toBe("3 tool calls · 2 failed");
  });

  test("a running turn names the tool it is in", () => {
    render(
      <WorkLog
        turn={turn({
          running: true,
          groups: [{ id: "g", rows: [row("a", "Read"), row("b", "Bash", { status: "running" })] }],
        })}
      />,
    );

    expect(summary()).toBe("2 tool calls · Bash");
    expect(screen.getByTestId("work-log").getAttribute("data-running")).toBe("true");
  });

  test("a finished turn does not name a tool, even if a row was left running", () => {
    render(
      <WorkLog
        turn={turn({ groups: [{ id: "g", rows: [row("a", "Bash", { status: "running" })] }] })}
      />,
    );

    expect(summary()).toBe("1 tool call");
    expect(screen.getByTestId("work-log").getAttribute("data-running")).toBe("false");
  });

  test("is tied to the reply it belongs to", () => {
    render(<WorkLog turn={turn({ messageId: "msg_42" })} />);

    expect(screen.getByTestId("work-log").getAttribute("data-turn-id")).toBe("msg_42");
  });
});

describe("opened", () => {
  test("is folded until asked for", () => {
    render(<WorkLog turn={turn({ groups: [{ id: "g", rows: [row("a", "Bash")] }] })} />);

    expect(screen.queryAllByTestId("work-log-row")).toHaveLength(0);

    open();
    expect(screen.getAllByTestId("work-log-row")).toHaveLength(1);

    open();
    expect(screen.queryAllByTestId("work-log-row")).toHaveLength(0);
  });

  test("shows every call in order with its status and what it was asked to do", () => {
    render(
      <WorkLog
        turn={turn({
          groups: [
            { id: "g1", rows: [row("a", "Bash", { detail: "npm test" })] },
            {
              id: "g2",
              rows: [
                row("b", "Edit", { detail: "src/login.ts", status: "failed" }),
                row("c", "Read", { status: "running" }),
              ],
            },
          ],
        })}
      />,
    );
    open();

    const rows = screen.getAllByTestId("work-log-row");
    expect(rows.map((item) => item.getAttribute("data-status"))).toEqual([
      "done",
      "failed",
      "running",
    ]);
    expect(rows[0]?.textContent).toContain("Bash");
    expect(rows[0]?.textContent).toContain("npm test");
    expect(rows[1]?.textContent).toContain("Edit");
    expect(rows[1]?.textContent).toContain("src/login.ts");
    expect(rows[1]?.querySelector("[aria-label='Failed']")).not.toBeNull();
    expect(rows[0]?.querySelector("[aria-label='Done']")).not.toBeNull();
    expect(rows[2]?.textContent).toBe("Read");
  });

  test("shows the narration the agent said on the way", () => {
    render(
      <WorkLog
        turn={turn({
          narration: "Looking at the login handler.\n\nFound the redirect.",
          groups: [{ id: "g", rows: [row("a", "Read")] }],
        })}
      />,
    );
    expect(screen.queryByTestId("work-log-narration")).toBeNull();

    open();

    const narration = screen.getByTestId("work-log-narration").textContent ?? "";
    expect(narration).toContain("Looking at the login handler.");
    expect(narration).toContain("Found the redirect.");
  });

  test("a turn with no narration has no narration block", () => {
    render(<WorkLog turn={turn({ groups: [{ id: "g", rows: [row("a", "Read")] }] })} />);
    open();

    expect(screen.queryByTestId("work-log-narration")).toBeNull();
  });
});
