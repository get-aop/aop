import type { CuaProbeDeps } from "./cua-driver.ts";

export const CUA_PATH = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
export const CHECKED_AT = "2026-10-01T12:00:00.000Z";

/** What CUA Driver 0.32's daemon reports with both grants and Tahoe's consent unread. */
export const GRANTED = JSON.stringify({
  accessibility: true,
  screen_recording: true,
  direct_capture_status: "not_checked",
});

export interface FakeCuaOptions {
  /** `permissions status --json` output; a thrown error when it is an Error. */
  permissions?: string | Error;
  /** `--version` output; a thrown error (a timeout) when it is an Error. */
  version?: string | Error;
  /** `check-update --json`'s latest version; null makes the check fail (offline). */
  latest?: string | null;
}

/** A host with a `cua-driver` that answers the probe the way CUA Driver 0.32 does. */
export const fakeCua = (
  options: FakeCuaOptions = {},
  overrides: Partial<CuaProbeDeps> = {},
): CuaProbeDeps & { calls: string[][] } => {
  const calls: string[][] = [];
  const answer = (value: string | Error) => {
    if (value instanceof Error) throw value;
    return { exitCode: 0, output: value };
  };
  return {
    calls,
    locate: () => CUA_PATH,
    platform: "darwin",
    hostName: async () => "Studio Mac",
    now: () => new Date(CHECKED_AT),
    run: async (argv) => {
      calls.push(argv);
      if (argv[1] === "--version") return answer(options.version ?? "cua-driver 0.32.0\n");
      if (argv[1] === "check-update") {
        if (options.latest === null) throw new Error("offline");
        return answer(JSON.stringify({ latest_version: options.latest ?? "0.32.0" }));
      }
      return answer(options.permissions ?? GRANTED);
    },
    ...overrides,
  };
};
