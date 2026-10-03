import { describe, expect, test } from "bun:test";
import { clearanceFor } from "./live-view-clearance";

const popup = { left: 900, top: 560, right: 1188, bottom: 788 };

describe("room a list keeps for the popup", () => {
  test("from the popup's top edge to the list's visible bottom, and a gap", () => {
    const panel = { left: 680, top: 56, right: 1200, bottom: 1600 };
    expect(clearanceFor(popup, panel, 800)).toBe(800 - 560 + 12);
  });

  test("none for a list in another column, or one that ends above the popup", () => {
    const chat = { left: 0, top: 56, right: 680, bottom: 800 };
    expect(clearanceFor(popup, chat, 800)).toBe(0);
    const short = { left: 680, top: 56, right: 1200, bottom: 400 };
    expect(clearanceFor(popup, short, 400)).toBe(0);
  });

  test("none for a hidden list (no box)", () => {
    expect(clearanceFor(popup, { left: 0, top: 0, right: 0, bottom: 0 }, 0)).toBe(0);
  });
});
