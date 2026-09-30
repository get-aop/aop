import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { AT, makeThread } from "../test-utils";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { ThreadChipDetails } = await import("./ThreadChip");

afterEach(cleanup);

const later = (minutes: number) => Date.parse(AT) + minutes * 60_000;

describe("ThreadChipDetails", () => {
  test("says what state the thread is in, its title, and how much has been said and when", () => {
    render(
      <ThreadChipDetails
        thread={makeThread({ title: "Fix the login redirect", status: "working", repliesCount: 3 })}
        now={later(5)}
      />,
    );

    expect(screen.getByTestId("thread-chip-status").textContent).toBe("Working");
    expect(screen.getByTestId("thread-chip-title").textContent).toBe("Fix the login redirect");
    expect(screen.getByTestId("thread-chip-activity").textContent).toBe("3 replies · 5m");
  });

  test("reads naturally for none and for one reply, and marks a thread that waits on the person", () => {
    const { rerender } = render(
      <ThreadChipDetails
        thread={makeThread({ status: "waiting-on-you", repliesCount: 0 })}
        now={later(0)}
      />,
    );
    expect(screen.getByTestId("thread-chip-status").textContent).toBe("Waiting on you");
    expect(screen.getByTestId("thread-chip-status").className).toContain("text-waiting");
    expect(screen.getByTestId("thread-chip-activity").textContent).toBe("No replies yet · now");

    rerender(
      <ThreadChipDetails
        thread={makeThread({ status: "idle", repliesCount: 1 })}
        now={later(120)}
      />,
    );
    expect(screen.getByTestId("thread-chip-activity").textContent).toBe("1 reply · 2h");
  });
});
