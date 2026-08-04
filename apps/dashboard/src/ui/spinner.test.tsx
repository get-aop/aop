import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { Spinner } from "./spinner";

setupDashboardDom();
const { cleanup, render, screen } = await import("@testing-library/react");
afterEach(cleanup);

describe("Spinner", () => {
  test("is a plain ring, never a conic/icon loader", () => {
    render(<Spinner data-testid="spin" />);
    const el = screen.getByTestId("spin");
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("rounded-full");
    expect(el.className).toContain("border-t-text");
    expect(el.className).toContain("aop-spin_1s_linear_infinite");
    expect(el.querySelector("svg")).toBeNull();
  });

  test("carries the reduced-motion kill class", () => {
    render(<Spinner data-testid="spin" />);
    expect(screen.getByTestId("spin").className).toContain("aop-spinner");
  });
});
