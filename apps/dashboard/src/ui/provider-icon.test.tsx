import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { RuntimeProviderIcon } from "./provider-icon";

setupDashboardDom();
const { cleanup, render, screen } = await import("@testing-library/react");
afterEach(cleanup);

describe("RuntimeProviderIcon", () => {
  test("resolves the official brand marks", () => {
    const cases: Array<[string, string]> = [
      ["pi", "0 0 800 800"],
      ["claude-code", "0 0 256 257"],
      ["grok", "0 0 24 24"],
      ["open-code", "0 0 32 40"],
      ["codex-cli", "0 0 256 260"],
    ];

    for (const [runtime, viewBox] of cases) {
      const { unmount } = render(<RuntimeProviderIcon runtime={runtime} data-testid="icon" />);
      expect(screen.getByTestId("icon").getAttribute("viewBox")).toBe(viewBox);
      unmount();
    }
  });

  test("tints Claude with the brand color, others foreground", () => {
    const { unmount } = render(<RuntimeProviderIcon runtime="claude-code" data-testid="c" />);
    expect(screen.getByTestId("c").className).toContain("text-[#d97757]");
    unmount();

    render(<RuntimeProviderIcon runtime="codex-cli" data-testid="o" />);
    expect(screen.getByTestId("o").className).toContain("text-foreground/90");
  });

  test("pi's inner fill uses the surface token", () => {
    render(<RuntimeProviderIcon runtime="pi" data-testid="pi" />);
    const fills = [...screen.getByTestId("pi").querySelectorAll("path")].map((p) =>
      p.getAttribute("fill"),
    );
    expect(fills).toContain("var(--color-surface, #161618)");
  });
});
