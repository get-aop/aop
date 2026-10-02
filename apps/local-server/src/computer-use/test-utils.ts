import type { CuaProbeDeps } from "./cua-driver.ts";
import type { CaptureProcess, Frame, StartCapture } from "./screen-capture.ts";

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

/** One part of ffmpeg's `mpjpeg` output carrying `jpeg`. */
export const mpjpegPart = (jpeg: Uint8Array): Uint8Array => {
  const head = new TextEncoder().encode(
    `--ffmpeg\r\nContent-type: image/jpeg\r\nContent-length: ${jpeg.length}\r\n\r\n`,
  );
  return new Uint8Array([...head, ...jpeg, 0x0d, 0x0a]);
};

/** A stand-in ffmpeg: the test writes frames and stderr to it, and ends it with an exit code. */
export const fakeCaptureProcess = () => {
  let stdout!: ReadableStreamDefaultController<Uint8Array>;
  let stderr!: ReadableStreamDefaultController<Uint8Array>;
  let exit!: (code: number) => void;
  const state = { killed: false };
  const process: CaptureProcess = {
    stdout: new ReadableStream({
      start(controller) {
        stdout = controller;
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        stderr = controller;
      },
    }),
    exited: new Promise<number>((resolve) => {
      exit = resolve;
    }),
    kill: () => {
      state.killed = true;
      exit(143);
    },
  };
  return {
    process,
    state,
    frame: (bytes: number[]) => stdout.enqueue(mpjpegPart(new Uint8Array(bytes))),
    fail: (message: string, code = 1) => {
      stderr.enqueue(new TextEncoder().encode(`${message}\n`));
      stderr.close();
      exit(code);
    },
  };
};

/**
 * A capture the test controls: `start` counts starts, `frames` is what `latest` returns next,
 * and `unavailable` makes every start answer that reason instead.
 */
export const fakeCapture = () => {
  const control = {
    starts: 0,
    stops: 0,
    running: false,
    frame: null as Frame | null,
    failure: null as string | null,
    unavailable: null as string | null,
  };
  const start: StartCapture = () => {
    if (control.unavailable) return { unavailable: control.unavailable };
    control.starts += 1;
    control.running = true;
    return {
      latest: () => control.frame,
      failure: () => control.failure,
      stop: () => {
        control.stops += 1;
        control.running = false;
      },
    };
  };
  return { control, start };
};

/** A clock and a hand-driven ticker for the live view. */
export const manualTime = () => {
  let at = Date.parse("2026-10-02T12:00:00.000Z");
  const ticks = new Set<() => void>();
  return {
    now: () => at,
    every: (_ms: number, run: () => void) => {
      ticks.add(run);
      return () => ticks.delete(run);
    },
    /** Moves the clock and runs the scheduled checks once. */
    advance: (ms: number) => {
      at += ms;
      for (const run of [...ticks]) run();
    },
    tickers: () => ticks.size,
  };
};
