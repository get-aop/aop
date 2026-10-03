import { CUA_DRIVER_VERSION } from "@aop/common";
import type { CuaProbeDeps } from "./cua-driver.ts";
import type { SpawnDriver } from "./driver-client.ts";
import { type CuaLeaseDeps, createCuaLease } from "./lease.ts";
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
    inspect: async (driverNeedsSetup) => ({
      checks: [],
      fix: {
        command: driverNeedsSetup ? "aop computer-use setup" : null,
        sudoCommand: null,
        missing: [],
        pinnedVersion: CUA_DRIVER_VERSION,
      },
      noDisplay: false,
    }),
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

export const A = { id: "thr_a", projectId: "prj_1", title: "Check the login page" };
export const B = { id: "thr_b", projectId: "prj_1", title: "Fix the footer" };
export const C = { id: "thr_c", projectId: "prj_2", title: "Try the settings dialog" };

/** A lease on a hand-driven clock and timer; `tick` runs what its one-second timer would. */
export const leaseClock = (deps: Partial<CuaLeaseDeps> = {}) => {
  let at = Date.parse("2026-10-03T12:00:00.000Z");
  const clock = { now: () => at, advance: (ms: number) => (at += ms) };
  let run: () => void = () => {};
  const lease = createCuaLease({
    externalLock: null,
    now: clock.now,
    every: (_ms, next) => {
      run = next;
      return () => {};
    },
    ...deps,
  });
  return { lease, clock, tick: () => run() };
};

/** Lets pending promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export interface FakeDriver {
  spawn: SpawnDriver;
  /** Every request each started process got, in order: `<process #>:<method>[:<tool>]`. */
  calls: string[];
  /** How many processes were started and how many ended. */
  started: () => number;
  ended: () => number;
  /** Tool calls named `hold` wait until this is called. */
  releaseHeld: () => void;
}

interface FakeRequest {
  id?: unknown;
  method: string;
  params?: { name?: string };
}

// What CUA Driver 0.32 answers, cut down: its handshake, one tool, and calls that echo their name.
const fakeResult = (index: number, request: FakeRequest): unknown => {
  if (request.method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "cua-driver", version: "0.32.0" },
      instructions: "cua-driver: computer-use automation.",
    };
  }
  if (request.method === "tools/list") {
    return { tools: [{ name: "click", inputSchema: { type: "object" } }] };
  }
  if (request.method === "server/discover") {
    return { instructions: `${index}:server/discover`, resultType: "complete" };
  }
  return {
    content: [{ type: "text", text: `${index}:${request.params?.name ?? request.method}` }],
  };
};

/** A stand-in for `cua-driver mcp` that answers MCP over stdio-like lines, in memory. */
export const fakeDriver = (): FakeDriver => {
  const calls: string[] = [];
  let started = 0;
  let ended = 0;
  let held: Array<() => void> = [];
  const spawn: SpawnDriver = () => {
    const index = ++started;
    const out: string[] = [];
    let wake: (() => void) | null = null;
    let open = true;
    let exit: (code: number) => void = () => {};
    const exited = new Promise<number | null>((resolve) => {
      exit = resolve;
    });
    const push = (message: unknown) => {
      out.push(JSON.stringify(message));
      wake?.();
    };
    const answer = async (request: FakeRequest) => {
      const tool = request.method === "tools/call" ? `:${request.params?.name}` : "";
      calls.push(`${index}:${request.method}${tool}`);
      if (request.id === undefined) return;
      if (request.params?.name === "hold") await new Promise<void>((r) => held.push(r));
      push({ jsonrpc: "2.0", id: request.id, result: fakeResult(index, request) });
    };
    async function* lines() {
      while (open || out.length > 0) {
        const next = out.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    }
    const stop = () => {
      if (!open) return;
      open = false;
      ended += 1;
      wake?.();
      exit(0);
    };
    return {
      write: (line) => void answer(JSON.parse(line)),
      lines: lines(),
      end: stop,
      kill: stop,
      exited,
    };
  };
  return {
    spawn,
    calls,
    started: () => started,
    ended: () => ended,
    releaseHeld: () => {
      for (const resume of held) resume();
      held = [];
    },
  };
};

/** A JSON-RPC message as the gate's tests read it. */
export interface Rpc {
  id?: unknown;
  method?: string;
  params?: { progressToken?: unknown; message?: string };
  result?: {
    isError?: boolean;
    resultType?: string;
    serverInfo?: { name: string };
    capabilities?: unknown;
    instructions?: string;
    tools?: Array<{ name: string }>;
    content?: Array<{ text?: string }>;
  };
}

/** The JSON-RPC messages of a server-sent event stream's body. */
export const sseMessages = (body: string): Rpc[] =>
  body
    .split("\n\n")
    .flatMap((part) => part.split("\n").filter((line) => line.startsWith("data: ")))
    .map((line) => JSON.parse(line.slice("data: ".length)));
