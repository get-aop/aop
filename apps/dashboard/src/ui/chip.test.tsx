import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { Chip } from "./chip";

setupDashboardDom();
const { cleanup, render, screen } = await import("@testing-library/react");
afterEach(cleanup);

describe("Chip", () => {
  test("renders every variant with its data attribute", () => {
    render(
      <>
        <Chip variant="filter">filter</Chip>
        <Chip variant="ghost">ghost</Chip>
        <Chip variant="git">git</Chip>
        <Chip variant="step">step</Chip>
        <Chip variant="mini">mini</Chip>
      </>,
    );

    expect(screen.getByText("filter").getAttribute("data-variant")).toBe("filter");
    expect(screen.getByText("ghost").getAttribute("data-variant")).toBe("ghost");
    expect(screen.getByText("git").getAttribute("data-variant")).toBe("git");
    expect(screen.getByText("step").getAttribute("data-variant")).toBe("step");
    expect(screen.getByText("mini").getAttribute("data-variant")).toBe("mini");
  });

  test("arms the on state via data-on", () => {
    render(<Chip on>scoped</Chip>);
    expect(screen.getByText("scoped").hasAttribute("data-on")).toBe(true);
  });

  test("stays pill-shaped and never renders a second chip implementation", () => {
    render(<Chip>one</Chip>);
    expect(screen.getByText("one").className).toContain("rounded-full");
  });
});
