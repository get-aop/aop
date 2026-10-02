import { isAbsolute } from "node:path";
import { buildSpawnEnv, getLogger } from "@aop/infra";
import { resolveRuntimeExecutable } from "@aop/llm-provider";
import { createMpjpegParser } from "./mpjpeg.ts";

const logger = getLogger("live-view");

/** Frames per second ffmpeg grabs; viewers poll at their own pace up to this. */
export const CAPTURE_FPS = 4;
/** Frames wider than this are scaled down (height follows), so a 4K screen costs what 1280 does. */
export const CAPTURE_MAX_WIDTH = 1280;

export interface Frame {
  /** Changes only when the picture does, so an unchanged screen answers 304. */
  id: number;
  jpeg: Uint8Array;
}

/** A running capture of the host's screen. */
export interface ScreenCapture {
  latest: () => Frame | null;
  /** Why it stopped by itself (ffmpeg exited), or null while it runs. */
  failure: () => string | null;
  stop: () => void;
}

/** Starts a capture, or says why this host cannot. */
export type StartCapture = () => ScreenCapture | { unavailable: string };

/** The parts of a child process a capture uses, so tests can stand in a fake ffmpeg. */
export interface CaptureProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: () => void;
}

export interface ScreenCaptureDeps {
  platform: NodeJS.Platform;
  /** The X display the host's runs (and so CUA Driver) get, or undefined when there is none. */
  display: () => string | undefined;
  /** The ffmpeg to run, or null when there is none. */
  locateFfmpeg: () => string | null;
  spawn: (argv: string[]) => CaptureProcess;
}

/**
 * Captures the display CUA Driver drives. On Linux that is the X display in the host's spawn
 * environment (`DISPLAY`, e.g. an Xvfb), grabbed by ffmpeg's x11grab and written as a stream of
 * JPEGs. Other systems are not supported yet; every unavailable case says why, for the popup.
 */
export const createScreenCapture =
  (deps: ScreenCaptureDeps = defaultDeps): StartCapture =>
  () => {
    if (deps.platform !== "linux") {
      return {
        unavailable: `capturing the screen is not supported on ${platformName(deps.platform)} yet.`,
      };
    }
    const display = deps.display()?.trim();
    if (!display) return { unavailable: "the host has no X display (DISPLAY is not set)." };
    const ffmpeg = deps.locateFfmpeg();
    if (!ffmpeg) return { unavailable: "ffmpeg is not installed on the host." };
    return runFfmpeg(deps.spawn(ffmpegArgv(ffmpeg, display)));
  };

export const ffmpegArgv = (ffmpeg: string, display: string): string[] => [
  ffmpeg,
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "x11grab",
  "-framerate",
  String(CAPTURE_FPS),
  "-i",
  display,
  "-vf",
  `scale='min(${CAPTURE_MAX_WIDTH},iw)':-2`,
  "-c:v",
  "mjpeg",
  "-q:v",
  "7",
  "-f",
  "mpjpeg",
  "pipe:1",
];

const runFfmpeg = (child: CaptureProcess): ScreenCapture => {
  let latest: Frame | null = null;
  let lastHash: bigint | number | null = null;
  let failure: string | null = null;
  let stopped = false;
  let stderrTail = "";

  const parser = createMpjpegParser((jpeg) => {
    const hash = Bun.hash(jpeg);
    if (latest && hash === lastHash) return;
    lastHash = hash;
    latest = { id: (latest?.id ?? 0) + 1, jpeg };
  });

  void pump(child.stdout, (chunk) => parser.push(chunk));
  const stderrRead = pump(child.stderr, (chunk) => {
    stderrTail = (stderrTail + new TextDecoder().decode(chunk)).slice(-2000);
  });
  void child.exited.then(async (code) => {
    if (stopped) return;
    // What ffmpeg printed last says why; give its pipe a moment to drain.
    await Promise.race([stderrRead, Bun.sleep(250)]);
    const lastLine = stderrTail.trim().split("\n").at(-1)?.trim();
    failure = `the capture stopped (ffmpeg exited with ${code}${lastLine ? `: ${lastLine}` : ""}).`;
    logger.warn("Live view capture stopped: {failure}", { failure });
  });

  return {
    latest: () => latest,
    failure: () => failure,
    stop: () => {
      stopped = true;
      child.kill();
    },
  };
};

const pump = async (
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> => {
  try {
    for await (const chunk of stream) onChunk(chunk);
  } catch {
    // The process was killed mid-read; whatever it had to say is moot.
  }
};

const platformName = (platform: NodeJS.Platform): string =>
  platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform;

const locateFfmpeg = (): string | null => {
  const resolved = resolveRuntimeExecutable("ffmpeg", buildSpawnEnv().PATH);
  return isAbsolute(resolved) ? resolved : null;
};

const defaultDeps: ScreenCaptureDeps = {
  platform: process.platform,
  display: () => buildSpawnEnv().DISPLAY,
  locateFfmpeg,
  spawn: (argv) => {
    const child = Bun.spawn(argv, {
      env: buildSpawnEnv(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      kill: () => child.kill(),
    };
  },
};
