import type { CuaProbeDeps } from "./cua-driver.ts";

export const CUA_PATH = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

export const GRANTED = JSON.stringify({ accessibility: true, screen_recording: true });

/** A driver that answers `--version` and `permissions status --json` the way CUA Driver 0.32 does. */
export const fakeCua = (
  permissions: string = GRANTED,
  overrides: Partial<CuaProbeDeps> = {},
): CuaProbeDeps & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    locate: () => CUA_PATH,
    platform: "darwin",
    run: async (argv) => {
      calls.push(argv);
      return argv[1] === "--version"
        ? { exitCode: 0, output: "cua-driver 0.32.0\n" }
        : { exitCode: 0, output: permissions };
    },
    ...overrides,
  };
};
