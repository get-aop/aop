import { isNewerRelease } from "@aop/common";

const VERSION_PATTERN =
  /(?:^|[^\d.])v?(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?![\d.])/;

/**
 * The version in what a CLI prints for `--version`: `2.1.286 (Claude Code)`, `codex-cli 0.46.0`,
 * `v1.2.3`. A pre-release or build suffix is dropped. Null when there is no x.y.z in it.
 */
export const parseCliVersion = (output: string): string | null =>
  output.match(VERSION_PATTERN)?.[1] ?? null;

/** Whether `latest` is newer than the installed `current`; an unknown version is never older. */
export const isCliUpdateAvailable = (latest: string | null, current: string | null): boolean =>
  latest !== null && current !== null && isNewerRelease(latest, current);
