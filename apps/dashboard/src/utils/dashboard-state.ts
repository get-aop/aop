export type DashboardTheme = "light" | "dark";

export const SELECTED_REPO_STORAGE_KEY = "aop:selected-repo-id";
export const REPO_SCOPE_STORAGE_KEY = "aop:repo-scope:v1";
export const DASHBOARD_THEME_STORAGE_KEY = "aop:dashboard-theme:v1";

/** Dark is the default AOP look; light stays available through the toggle. */
export const DEFAULT_DASHBOARD_THEME: DashboardTheme = "dark";

export const loadDashboardTheme = (): DashboardTheme =>
  parseDashboardTheme(readStorageValue(DASHBOARD_THEME_STORAGE_KEY)) ?? DEFAULT_DASHBOARD_THEME;

export const saveDashboardTheme = (theme: DashboardTheme): void => {
  writeStorageValue(DASHBOARD_THEME_STORAGE_KEY, theme);
};

export const loadSelectedRepoId = (): string | null => readStorageValue(SELECTED_REPO_STORAGE_KEY);

export const saveSelectedRepoId = (repoId: string | null): void => {
  writeStorageValue(SELECTED_REPO_STORAGE_KEY, repoId);
};

/** Sidebar repo-scope filter. Null = "All" (no filtering). */
export const loadRepoScope = (): string[] | null => {
  const raw = readStorageValue(REPO_SCOPE_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((id): id is string => typeof id === "string");
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
};

export const saveRepoScope = (scope: string[] | null): void => {
  writeStorageValue(
    REPO_SCOPE_STORAGE_KEY,
    scope && scope.length > 0 ? JSON.stringify(scope) : null,
  );
};

const parseDashboardTheme = (value: string | null): DashboardTheme | null => {
  if (value === "light" || value === "dark") {
    return value;
  }

  return null;
};

const readStorageValue = (key: string): string | null => {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorageValue = (key: string, value: string | null): void => {
  try {
    if (value === null) {
      globalThis.localStorage.removeItem(key);
      return;
    }

    globalThis.localStorage.setItem(key, value);
  } catch {
    // Storage is not available in every rendering environment.
  }
};
