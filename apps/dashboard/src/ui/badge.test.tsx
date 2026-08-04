import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { Badge } from "./badge";

setupDashboardDom();
const { cleanup, render, screen } = await import("@testing-library/react");
afterEach(cleanup);

describe("Badge status map", () => {
  test("maps every status to its functional-color classes", () => {
    const cases = [
      ["done", "text-ok"],
      ["working", "text-running"],
      ["blocked", "text-blocked"],
      ["ready", "text-favorite"],
      ["draft", "text-queued"],
    ] as const;

    for (const [variant, tone] of cases) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      const el = screen.getByText(variant);
      expect(el.getAttribute("data-variant")).toBe(variant);
      expect(el.className).toContain(tone);
      unmount();
    }
  });

  test("count variant renders the unread pill", () => {
    render(<Badge variant="count">3</Badge>);
    const el = screen.getByText("3");
    expect(el.className).toContain("bg-text");
    expect(el.className).toContain("text-canvas");
  });

  test("tag variant renders mono meta tags", () => {
    render(<Badge variant="tag">Legacy</Badge>);
    expect(screen.getByText("Legacy").className).toContain("font-mono");
  });
});
