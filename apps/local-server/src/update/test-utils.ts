import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostManagement, ReleaseChannel } from "@aop/common";
import { type InstallLayout, layoutOf } from "./install-layout.ts";
import type { InstallPolicy } from "./install-policy.ts";
import type { RunningTurnRef } from "./queued-update.ts";
import { downloadFetch } from "./release-feed.ts";
import type { StageTools } from "./stage.ts";
import type { UpdateServiceDeps } from "./update-service.ts";

export const PLATFORM = { os: "darwin", arch: "arm64" } as const;
export const BINARY_ASSET = "aop-darwin-arm64";

export const scratchDir = (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), `aop-update-${prefix}-`));

/** A host binary stand-in: a script that prints `version` for --version, like the real one. */
export const fakeBinary = (version: string, options: { broken?: boolean } = {}): string =>
  options.broken
    ? "#!/bin/sh\nexit 1\n"
    : `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "aop/${version}+abc1234 darwin-arm64 bun-v1.0.0"; fi\n`;

/** An install as install.sh leaves it: `aop` and `dashboard/` in one folder. */
export const createInstall = async (version: string): Promise<InstallLayout> => {
  const installDir = await scratchDir("install");
  const layout = layoutOf(join(installDir, "aop"));
  await writeFile(layout.binaryPath, fakeBinary(version));
  await chmod(layout.binaryPath, 0o755);
  await mkdir(layout.dashboardDir);
  await writeFile(join(layout.dashboardDir, "index.html"), `dashboard ${version}`);
  return layout;
};

export interface FakeRelease {
  /** The origin standing in for getaop.com (and for api.github.com, for the fallback). */
  url: string;
  /** Files served, so a test can damage one before the download. */
  files: Map<string, Uint8Array>;
  /** Each request as `<path> <authorization or "-">`. */
  requests: string[];
  /** Fields added to `releases/latest.json`, such as the `cuaDriver` a release pins. */
  feedExtras: Record<string, unknown>;
  stop: () => void;
}

export interface FakeReleaseOptions {
  version: string;
  /** The host binary's asset name; `BINARY_ASSET` unless the test updates this machine's host. */
  binaryAsset?: string;
  /** The binary prints nothing useful and exits 1. */
  brokenBinary?: boolean;
  /** The binary differs from what the feed and `checksums.sha256` promised. */
  corruptBinary?: boolean;
  /** Leaves the binary's line out of `checksums.sha256`. */
  omitBinaryChecksum?: boolean;
  /** `releases/latest.json` answers 404, as before the first release that publishes it. */
  feedDown?: boolean;
}

export const FAKE_TOKEN = "ghp_test";

/**
 * Serves a release the way getaop.com does (`releases/latest.json` and the files), and the way
 * GitHub serves a private repository's release to a token: the API asset address redirects to
 * signed storage, which refuses a request that still carries the token.
 */
export const startFakeRelease = async (options: FakeReleaseOptions): Promise<FakeRelease> => {
  const files = await buildReleaseFiles(options);
  const digests = new Map([...files].map(([name, data]) => [name, sha256(data)]));
  if (options.corruptBinary) digests.set(binaryAssetOf(options), sha256(PROMISED));
  const requests: string[] = [];
  const feedExtras: Record<string, unknown> = {};
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request): Response => {
      const { pathname } = new URL(request.url);
      const authorization = request.headers.get("authorization");
      requests.push(`${pathname} ${authorization ?? "-"}`);
      const base = `http://127.0.0.1:${server.port}`;
      return routeFakeRelease({
        pathname,
        authorization,
        base,
        options,
        files,
        digests,
        feedExtras,
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    files,
    requests,
    feedExtras,
    stop: () => server.stop(true),
  };
};

const PROMISED = new TextEncoder().encode("what was promised");

interface FakeRequest {
  pathname: string;
  authorization: string | null;
  base: string;
  options: FakeReleaseOptions;
  files: Map<string, Uint8Array>;
  digests: Map<string, string>;
  feedExtras: Record<string, unknown>;
}

const routeFakeRelease = (req: FakeRequest): Response => {
  const { pathname, base, options, files } = req;
  const name = decodeURIComponent(pathname.split("/").at(-1) ?? "");
  if (pathname === "/releases/latest.json") {
    return options.feedDown
      ? new Response("missing", { status: 404 })
      : Response.json({ ...feedOf(options, base, files, req.digests), ...req.feedExtras });
  }
  if (pathname.endsWith("/releases/latest")) {
    return withToken(req, () => Response.json(githubReleaseOf(options.version, base, files)));
  }
  if (pathname.startsWith("/api/assets/")) {
    return withToken(req, () => Response.redirect(`${base}/signed/${name}`, 302));
  }
  if (pathname.startsWith("/signed/") && req.authorization) {
    return new Response("only one auth mechanism allowed", { status: 400 });
  }
  const file = files.get(name);
  return file ? new Response(file) : new Response("missing", { status: 404 });
};

// A private repository answers 404, not 401, to a request without its token.
const withToken = (req: FakeRequest, respond: () => Response): Response =>
  req.authorization === `Bearer ${FAKE_TOKEN}` ? respond() : new Response("", { status: 404 });

const binaryAssetOf = (options: FakeReleaseOptions): string => options.binaryAsset ?? BINARY_ASSET;

const feedOf = (
  options: FakeReleaseOptions,
  base: string,
  files: Map<string, Uint8Array>,
  digests: Map<string, string>,
) => ({
  schemaVersion: 1,
  version: options.version,
  publishedAt: "2026-10-02T00:00:00Z",
  notes: `Notes of ${options.version}`,
  notesUrl: `${base}/releases/v${options.version}.md`,
  files: [...files].map(([name, data]) => ({
    name,
    kind: name === binaryAssetOf(options) ? "host" : "other",
    url: `${base}/v${options.version}/${name}`,
    sha256: digests.get(name),
    size: data.byteLength,
  })),
});

const githubReleaseOf = (version: string, base: string, files: Map<string, Uint8Array>) => ({
  tag_name: `v${version}`,
  html_url: `${base}/releases/tag/v${version}`,
  assets: [...files.keys()].map((name) => ({
    name,
    url: `${base}/api/assets/${name}`,
    browser_download_url: `${base}/download/${name}`,
  })),
});

const buildReleaseFiles = async (options: FakeReleaseOptions): Promise<Map<string, Uint8Array>> => {
  const binary = new TextEncoder().encode(
    fakeBinary(options.version, { broken: options.brokenBinary }),
  );
  const archive = await buildRuntimeAssets(`dashboard ${options.version}`);
  const listed = options.corruptBinary ? PROMISED : binary;
  const lines = [`${sha256(archive)}  runtime-assets.tar.gz`];
  if (!options.omitBinaryChecksum) lines.push(`${sha256(listed)}  ${binaryAssetOf(options)}`);
  return new Map<string, Uint8Array>([
    [binaryAssetOf(options), binary],
    ["runtime-assets.tar.gz", archive],
    ["checksums.sha256", new TextEncoder().encode(`${lines.join("\n")}\n`)],
  ]);
};

const buildRuntimeAssets = async (indexHtml: string): Promise<Uint8Array> => {
  const dir = await scratchDir("assets");
  await mkdir(join(dir, "dashboard"));
  await writeFile(join(dir, "dashboard", "index.html"), indexHtml);
  const archive = join(dir, "runtime-assets.tar.gz");
  await Bun.spawn(["tar", "-czf", archive, "-C", dir, "dashboard"]).exited;
  return new Uint8Array(await readFile(archive));
};

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Staging tools that do the real work on the machine, minus the OS signature. */
export const localStageTools = (): StageTools => ({
  fetch: downloadFetch,
  extract: async (archive, into) => {
    await mkdir(into, { recursive: true });
    await Bun.spawn(["tar", "-xzf", archive, "-C", into]).exited;
  },
  signBinary: async () => {},
  probeVersion: async (binary) => {
    const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "ignore" });
    const printed = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0) throw new Error("it exited with an error for --version");
    return printed;
  },
});

/** A throwaway HTTP server on a free port, for the feed or a host's health probe. */
export const serve = (handler: (request: Request) => Response) => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
};

export interface ServiceHarness {
  deps: UpdateServiceDeps;
  home: string;
  release: FakeRelease;
  startedUpdaters: number;
  clock: { now: number };
  setEnabled: (enabled: boolean) => void;
  /** The turns the host is running; tests change it as turns start and end. */
  turns: RunningTurnRef[];
  management: { setting: HostManagement };
  /** The `update_install` settings; tests change them. */
  policy: InstallPolicy;
  /** The minute of the day on the host's clock. */
  minute: { value: number };
}

export interface ServiceHarnessOptions {
  latest?: string;
  current?: string;
  supported?: boolean;
  startUpdater?: () => Promise<void>;
  channel?: ReleaseChannel;
}

export const serviceTurn = (runId: string, title = `Thread ${runId}`): RunningTurnRef => ({
  runId,
  title,
  kind: "thread",
});

/** An update service over a fake feed and a scratch home; `cleanup` gets what to stop after. */
export const createServiceHarness = async (
  options: ServiceHarnessOptions,
  cleanup: Array<() => void>,
): Promise<ServiceHarness> => {
  const release = await startFakeRelease({ version: options.latest ?? "0.10.0" });
  cleanup.push(release.stop);
  const home = await scratchDir("service");
  let enabled = true;
  const harness: ServiceHarness = {
    deps: {} as UpdateServiceDeps,
    home,
    release,
    startedUpdaters: 0,
    clock: { now: Date.parse("2026-10-01T10:00:00Z") },
    setEnabled: (value) => {
      enabled = value;
    },
    turns: [],
    management: { setting: "devices" },
    policy: { mode: "ask", window: [60, 360] },
    minute: { value: 10 * 60 },
  };
  harness.deps = {
    isEnabled: async () => enabled,
    unsupported:
      options.supported === false
        ? "This host runs from source and cannot update itself: pull and rebuild instead."
        : null,
    current: options.current ?? "0.9.51",
    feed: { origin: release.url, channel: options.channel ?? "stable", github: null },
    startUpdater:
      options.startUpdater ??
      (async () => {
        harness.startedUpdaters += 1;
      }),
    now: () => harness.clock.now,
    minuteOfDay: () => harness.minute.value,
    home,
    logFile: join(home, "logs", "update.log"),
    hostName: "soulf",
    restart: async () => "service",
    runningTurns: async () => harness.turns,
    hostManagement: async () => harness.management.setting,
    installPolicy: async () => harness.policy,
  };
  return harness;
};
