import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import {
  DASHBOARD_THEME_STORAGE_KEY,
  DEFAULT_DASHBOARD_THEME,
  loadDashboardTheme,
  saveDashboardTheme,
} from "./dashboard-state";

setupDashboardDom();

const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalLocalStorage,
    configurable: true,
    writable: true,
  });
  globalThis.localStorage.clear();
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalLocalStorage,
    configurable: true,
    writable: true,
  });
});

describe("dashboard theme preference", () => {
  test("defaults to dark when no theme preference is saved", () => {
    expect(loadDashboardTheme()).toBe(DEFAULT_DASHBOARD_THEME);
    expect(DEFAULT_DASHBOARD_THEME).toBe("dark");
  });

  test("loads a saved light mode preference from the versioned storage key", () => {
    globalThis.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, "light");

    expect(loadDashboardTheme()).toBe("light");
  });

  test("ignores invalid saved theme values", () => {
    globalThis.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, "system");

    expect(loadDashboardTheme()).toBe("dark");
  });

  test("saves the minimal theme value to the versioned storage key", () => {
    saveDashboardTheme("dark");

    expect(globalThis.localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY)).toBe("dark");
  });

  test("falls back safely when localStorage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("storage disabled");
        },
        setItem: () => {
          throw new Error("storage disabled");
        },
        removeItem: () => {
          throw new Error("storage disabled");
        },
      },
      configurable: true,
      writable: true,
    });

    expect(loadDashboardTheme()).toBe("dark");
    expect(() => saveDashboardTheme("dark")).not.toThrow();
  });
});
