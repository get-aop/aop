import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { UsageTip } = await import("./UsageTip");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("UsageTip", () => {
  test("says that threads run at once and spend usage faster, with a way to close it", () => {
    render(<UsageTip />);

    expect(screen.getByTestId("usage-tip").textContent).toBe(
      "Projects can run several threads at once and draw down your usage faster.",
    );
    expect(screen.getByRole("button", { name: "Dismiss tip" })).toBe(
      screen.getByTestId("usage-tip-dismiss"),
    );
  });

  test("once closed, this browser never shows it again, on any project", () => {
    render(<UsageTip />);
    fireEvent.click(screen.getByTestId("usage-tip-dismiss"));

    expect(screen.queryByTestId("usage-tip")).toBeNull();
    expect(window.localStorage.getItem("aop:usage-tip-dismissed:v1")).toBe("true");

    cleanup();
    render(<UsageTip />);
    expect(screen.queryByTestId("usage-tip")).toBeNull();
  });

  test("still closes when the browser refuses to store that it was closed", () => {
    const tried: string[] = [];
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: (key: string) => {
          tried.push(key);
          throw new Error("QuotaExceededError");
        },
      },
    });
    try {
      render(<UsageTip />);
      fireEvent.click(screen.getByTestId("usage-tip-dismiss"));
      expect(screen.queryByTestId("usage-tip")).toBeNull();
      expect(tried).toEqual(["aop:usage-tip-dismissed:v1"]);
    } finally {
      if (real) Object.defineProperty(window, "localStorage", real);
      else Reflect.deleteProperty(window, "localStorage");
    }
  });
});
