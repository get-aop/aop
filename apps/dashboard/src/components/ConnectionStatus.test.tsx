import { describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { render, screen } = await import("@testing-library/react");
const { ConnectionStatus } = await import("./ConnectionStatus");

describe("ConnectionStatus", () => {
  test("shows a muted dot when disconnected", () => {
    const { container } = render(<ConnectionStatus state="disconnected" />);
    expect(container.querySelector(".bg-text-subtle")).toBeDefined();
    expect(screen.queryByTestId("working-status-pill")).toBeNull();
  });

  test("shows a pulse dot when idle", () => {
    const { container } = render(<ConnectionStatus state="idle" />);
    expect(container.querySelector(".animate-pulse")).toBeDefined();
    expect(screen.queryByTestId("working-status-pill")).toBeNull();
  });

  test("renders nothing while tasks are working so cards own the animation", () => {
    const { container } = render(<ConnectionStatus state="working" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("working-status-pill")).toBeNull();
  });
});
