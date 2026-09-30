import { describe, expect, test } from "bun:test";
import { setupDashboardDom } from "./setup-dom";

setupDashboardDom();

const { getConfig } = await import("@testing-library/react");

describe("setupDashboardDom", () => {
  test("gives waitFor and findBy a deadline that a busy machine can meet, under bun's own", () => {
    const timeout = getConfig().asyncUtilTimeout;

    expect(timeout).toBeGreaterThan(1000);
    expect(timeout).toBeLessThan(5000);
  });
});
