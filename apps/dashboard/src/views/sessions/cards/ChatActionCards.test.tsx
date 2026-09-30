import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChatActionPayload } from "@aop/common";
import { setupDashboardDom } from "../../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ChatActionCards } = await import("./ChatActionCards");

afterEach(cleanup);

describe("ChatActionCards", () => {
  test("a session action opens that session when clicked", () => {
    const onOpenSession = mock((_sessionId: string) => {});
    const action: ChatActionPayload = {
      type: "session",
      id: "session-2",
      label: "Fresh session",
      sub: "Continue there",
      meta: "New",
    };
    render(<ChatActionCards action={action} onOpenSession={onOpenSession} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onOpenSession.mock.calls).toEqual([["session-2"]]);
  });

  test("other action types render their text without a button", () => {
    const onOpenSession = mock((_sessionId: string) => {});
    const action: ChatActionPayload = {
      type: "task",
      id: "task-1",
      label: "Task created",
      sub: "Ship it",
      meta: "Backlog",
    };
    render(<ChatActionCards action={action} onOpenSession={onOpenSession} />);

    expect(screen.getByText("Task created · Ship it · Backlog")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  test("a session action without an id degrades to text", () => {
    const action: ChatActionPayload = {
      type: "session",
      label: "Fresh session",
      sub: "",
      meta: "",
    };
    render(<ChatActionCards action={action} onOpenSession={() => {}} />);

    expect(screen.getByText("Fresh session")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
