import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InstallLayout, layoutOf } from "./install-layout.ts";
import type { StageTools } from "./stage.ts";

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
  /** Base URL standing in for api.github.com. */
  apiUrl: string;
  /** Files served, so a test can damage one before the download. */
  files: Map<string, Uint8Array>;
  requests: string[];
  stop: () => void;
}

export interface FakeReleaseOptions {
  version: string;
  /** The binary prints nothing useful and exits 1. */
  brokenBinary?: boolean;
  /** The binary differs from what `checksums.sha256` promised. */
  corruptBinary?: boolean;
  /** Leaves the binary's line out of `checksums.sha256`. */
  omitBinaryChecksum?: boolean;
}

/** Serves a release of the repo the way GitHub does, for the updater to read and download. */
export const startFakeRelease = async (options: FakeReleaseOptions): Promise<FakeRelease> => {
  const files = await buildReleaseFiles(options);
  const requests: string[] = [];
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request): Response => {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
      const base: string = `http://127.0.0.1:${server.port}`;
      if (pathname.endsWith("/releases/latest")) {
        return Response.json({
          tag_name: `v${options.version}`,
          html_url: `${base}/releases/tag/v${options.version}`,
          assets: [...files.keys()].map((name) => ({
            name,
            browser_download_url: `${base}/download/${name}`,
          })),
        });
      }
      const file = files.get(decodeURIComponent(pathname.replace("/download/", "")));
      return file ? new Response(file) : new Response("missing", { status: 404 });
    },
  });
  return {
    apiUrl: `http://127.0.0.1:${server.port}`,
    files,
    requests,
    stop: () => server.stop(true),
  };
};

const buildReleaseFiles = async (options: FakeReleaseOptions): Promise<Map<string, Uint8Array>> => {
  const binary = new TextEncoder().encode(
    fakeBinary(options.version, { broken: options.brokenBinary }),
  );
  const archive = await buildRuntimeAssets(`dashboard ${options.version}`);
  const listed = options.corruptBinary ? new TextEncoder().encode("what was promised") : binary;
  const lines = [`${sha256(archive)}  runtime-assets.tar.gz`];
  if (!options.omitBinaryChecksum) lines.push(`${sha256(listed)}  ${BINARY_ASSET}`);
  return new Map<string, Uint8Array>([
    [BINARY_ASSET, binary],
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
  fetch: (url) => fetch(url),
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
