import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { PROJECT_COLORS, tileHue } from "./project-appearance";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { ProjectTile } = await import("./ProjectTile");

afterEach(() => cleanup());

const drawn = { id: "prj_1", name: "checkout", icon: null, color: null } as const;

describe("ProjectTile", () => {
  test("with nothing picked, draws the name's first letter on a hue taken from the id", () => {
    render(<ProjectTile project={drawn} />);
    const tile = screen.getByTestId("project-tile");
    expect(tile.textContent).toBe("c");
    expect(tile.querySelector("svg")).toBeNull();
    expect(Object.values(PROJECT_COLORS).map(({ hue }) => hue)).toContain(tileHue(drawn));
    // The same id always lands on the same hue, on every device.
    expect(tileHue(drawn)).toBe(tileHue({ id: "prj_1", color: null }));
  });

  test("a picked icon replaces the letter, and a picked colour replaces the id's hue", () => {
    render(<ProjectTile project={{ ...drawn, icon: "rocket", color: "pink" }} />);
    const tile = screen.getByTestId("project-tile");
    expect(tile.textContent).toBe("");
    expect(tile.querySelector("svg")).not.toBeNull();
    expect(tile.dataset.icon).toBe("rocket");
    expect(tile.dataset.color).toBe("pink");
    expect(tileHue({ id: "prj_1", color: "pink" })).toBe(PROJECT_COLORS.pink.hue);
  });

  test("a blank name still draws something", () => {
    render(<ProjectTile project={{ ...drawn, name: "  " }} />);
    expect(screen.getByTestId("project-tile").textContent).toBe("?");
  });
});
