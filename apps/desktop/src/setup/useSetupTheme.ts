import { useCallback, useEffect, useState } from "react";

export type SetupTheme = "dark" | "light";

const STORAGE_KEY = "aop-setup-theme";
const DEFAULT_THEME: SetupTheme = "dark";

const readStoredTheme = (): SetupTheme => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" ? "light" : value === "dark" ? "dark" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};

/**
 * Owns the setup screen theme. Persisted to localStorage so the user's choice sticks
 * across relaunches, and mirrored onto `<html data-theme>` so the token blocks in
 * index.css resolve for the whole document.
 */
export const useSetupTheme = (): {
  theme: SetupTheme;
  toggleTheme: () => void;
} => {
  const [theme, setTheme] = useState<SetupTheme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage may be unavailable (private mode / sandbox); the in-memory choice still works.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
};
