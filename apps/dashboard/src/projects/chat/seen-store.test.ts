import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { browserSeenStore } = await import("./seen-store");

beforeEach(() => window.localStorage.clear());

describe("browserSeenStore", () => {
  test("remembers each project's last seen instant across reads", () => {
    browserSeenStore.set("prj_1", "2026-09-30T10:00:00.000Z");
    browserSeenStore.set("prj_2", "2026-09-30T11:00:00.000Z");

    expect(browserSeenStore.get("prj_1")).toBe("2026-09-30T10:00:00.000Z");
    expect(browserSeenStore.get("prj_2")).toBe("2026-09-30T11:00:00.000Z");
    expect(browserSeenStore.get("prj_3")).toBeNull();
  });

  test("reads storage it cannot parse as nothing seen", () => {
    window.localStorage.setItem("aop:coordinator-seen:v1", "{not json");
    expect(browserSeenStore.get("prj_1")).toBeNull();

    window.localStorage.setItem("aop:coordinator-seen:v1", "[1,2]");
    expect(browserSeenStore.get("prj_1")).toBeNull();
  });

  test("writing over unreadable storage replaces it", () => {
    window.localStorage.setItem("aop:coordinator-seen:v1", "{not json");

    browserSeenStore.set("prj_1", "2026-09-30T10:00:00.000Z");

    expect(browserSeenStore.get("prj_1")).toBe("2026-09-30T10:00:00.000Z");
  });
});
