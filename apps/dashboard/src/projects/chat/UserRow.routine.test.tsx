import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { userMessage } from "./test-utils";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { UserRow } = await import("./MessageRows");

afterEach(() => {
  cleanup();
});

describe("a brief a routine sent", () => {
  test("is the person's message, labelled with the routine's name", () => {
    render(
      <UserRow
        message={{
          ...userMessage("u1", 1, { text: "Write the weekly report" }),
          routine: { id: "rtn_1", name: "Weekly report" },
        }}
      />,
    );
    expect(screen.getByTestId("user-message-routine").textContent).toBe("Routine · Weekly report");
    expect(screen.getByTestId("user-message").textContent).toContain("Write the weekly report");
  });

  test("a message the person typed has no label", () => {
    render(<UserRow message={userMessage("u2", 1, { text: "hello" })} />);
    expect(screen.queryByTestId("user-message-routine")).toBeNull();
  });
});
