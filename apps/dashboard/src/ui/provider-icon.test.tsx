import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { RuntimeProviderIcon } from "./provider-icon";

setupDashboardDom();
const { cleanup, render, screen } = await import("@testing-library/react");
afterEach(cleanup);

describe("RuntimeProviderIcon", () => {
  test("renders the Claude mark tinted with the brand color", () => {
    render(<RuntimeProviderIcon runtime="claude-code" data-testid="icon" />);
    const icon = screen.getByTestId("icon");
    expect(icon.getAttribute("viewBox")).toBe("0 0 256 257");
    expect(icon.getAttribute("data-provider-icon")).toBe("claude-code");
    expect(icon.className).toContain("text-[#d97757]");
  });
});
