import { describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { AopLogoMark } from "./AopLogoMark";

setupDashboardDom();

const { render, screen } = await import("@testing-library/react");

describe("AopLogoMark", () => {
  test("renders accessible logo svg", () => {
    render(<AopLogoMark size={28} />);

    expect(screen.getByRole("img", { name: "AOP logo" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "AOP logo" }).getAttribute("width")).toBe("28");
  });

  test("applies bubble animation classes when animated", () => {
    const { container } = render(<AopLogoMark animated />);

    expect(container.querySelector(".logo-bubble-1")).toBeTruthy();
    expect(container.querySelector(".logo-bubble-2")).toBeTruthy();
    expect(container.querySelector(".logo-bubble-3")).toBeTruthy();
  });
});
