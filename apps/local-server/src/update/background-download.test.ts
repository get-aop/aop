import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createReleaseStager, type ReleaseStager } from "./background-download.ts";
import { downloadFetch, type FetchFn } from "./release-feed.ts";
import {
  createServiceHarness,
  type FakeReleaseOptions,
  PLATFORM,
  scratchDir,
  startFakeRelease,
} from "./test-utils.ts";
import { createUpdateService } from "./update-service.ts";

const stopAfter: Array<() => void> = [];
afterEach(() => {
  for (const stop of stopAfter.splice(0)) stop();
});

const fileRequests = (requests: string[]) => requests.filter((line) => line.startsWith("/v"));

const createStager = async (
  options: FakeReleaseOptions,
  clock = { now: 0 },
  fetchFiles: FetchFn = downloadFetch,
) => {
  const release = await startFakeRelease(options);
  stopAfter.push(release.stop);
  const root = join(await scratchDir("staged"), "update-staged");
  const stager = createReleaseStager({
    root,
    feed: { origin: release.url, channel: "stable", github: null },
    platform: PLATFORM,
    downloadFetch: fetchFiles,
    now: () => clock.now,
  });
  return { release, root, stager, clock };
};

describe("downloading a release ahead of time", () => {
  test("downloads the host binary and the runtime assets, checks them, and says it is ready", async () => {
    // The files wait until the test has seen the download running.
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const held: FetchFn = async (input, init) => {
      await gate;
      return downloadFetch(input, init);
    };
    const { release, root, stager } = await createStager({ version: "0.10.0" }, { now: 0 }, held);

    const staging = stager.stage("0.10.0");
    for (let tries = 0; tries < 100 && (await stager.view("0.10.0")).state === "idle"; tries++) {
      await Bun.sleep(5);
    }
    expect(await stager.view("0.10.0")).toEqual({
      state: "downloading",
      version: "0.10.0",
      error: null,
    });
    open();
    await staging;

    expect(await stager.view("0.10.0")).toEqual({ state: "ready", version: "0.10.0", error: null });
    expect((await readdir(join(root, "0.10.0"))).sort()).toEqual([
      "aop-darwin-arm64",
      "runtime-assets.tar.gz",
      "staged.json",
    ]);
    expect(fileRequests(release.requests).sort()).toEqual([
      "/v0.10.0/aop-darwin-arm64 -",
      "/v0.10.0/runtime-assets.tar.gz -",
    ]);
  });

  test("does not download again what is staged already", async () => {
    const { release, stager } = await createStager({ version: "0.10.0" });
    await stager.stage("0.10.0");
    release.requests.length = 0;

    await stager.stage("0.10.0");

    expect(release.requests).toEqual([]);
  });

  test("a file that fails its checksum leaves nothing staged, says why, and is tried again an hour later", async () => {
    const { release, root, stager, clock } = await createStager({
      version: "0.10.0",
      corruptBinary: true,
    });

    await stager.stage("0.10.0");

    const view = await stager.view("0.10.0");
    expect(view.state).toBe("failed");
    expect(view.error).toContain("Checksum verification failed for aop-darwin-arm64");
    expect(await readdir(root)).toEqual([]);

    release.requests.length = 0;
    await stager.stage("0.10.0");
    expect(release.requests).toEqual([]);

    clock.now += 61 * 60 * 1000;
    await stager.stage("0.10.0");
    expect(fileRequests(release.requests).length).toBeGreaterThan(0);
  });

  test("drops older staged releases and half-done downloads", async () => {
    const { root, stager } = await createStager({ version: "0.10.0" });
    await mkdir(join(root, "0.9.60"), { recursive: true });
    await writeFile(join(root, "0.9.60", "staged.json"), '{"version":"0.9.60","files":[]}');
    await mkdir(join(root, ".partial-abc"), { recursive: true });

    await stager.stage("0.10.0");

    expect(await readdir(root)).toEqual(["0.10.0"]);
    await stager.prune(null);
    expect(await readdir(root)).toEqual([]);
  });

  test("keeps a newer release the feed offered than the one the last check saw", async () => {
    const { release, root, stager } = await createStager({ version: "0.10.1" });
    await stager.stage("0.10.0");
    release.requests.length = 0;

    await stager.stage("0.10.0");

    expect(release.requests).toEqual([]);
    expect(await readdir(root)).toEqual(["0.10.1"]);
    expect((await stager.view("0.10.0")).state).toBe("idle");
    expect((await stager.view("0.10.1")).state).toBe("ready");
  });
});

describe("the update service's background download", () => {
  const harness = async () => {
    const h = await createServiceHarness({}, stopAfter);
    const root = join(h.home, "update-staged");
    const enabled = { value: true };
    const stager: ReleaseStager = createReleaseStager({
      root,
      feed: h.deps.feed,
      platform: PLATFORM,
      downloadFetch,
    });
    h.deps.download = { enabled: async () => enabled.value, stager };
    return { h, root, enabled };
  };

  test("stages the newer release the check saw and reports it ready", async () => {
    const { h } = await harness();
    const service = createUpdateService(h.deps);
    expect((await service.status()).download).toEqual({
      state: "idle",
      version: null,
      error: null,
    });

    await service.runDueCheck();
    await service.runBackgroundDownload();

    expect((await service.status()).download).toEqual({
      state: "ready",
      version: "0.10.0",
      error: null,
    });
  });

  test("downloads nothing while the setting or the update check is off", async () => {
    const { h, enabled } = await harness();
    const service = createUpdateService(h.deps);
    await service.runDueCheck();

    enabled.value = false;
    await service.runBackgroundDownload();
    h.setEnabled(false);
    enabled.value = true;
    await service.runBackgroundDownload();

    expect(fileRequests(h.release.requests)).toEqual([]);
    expect((await service.status()).download.state).toBe("idle");
  });

  test("clears what it staged once the host runs that release", async () => {
    const { h, root } = await harness();
    await createUpdateService(h.deps).runDueCheck();
    await createUpdateService(h.deps).runBackgroundDownload();
    expect(await readdir(root)).toEqual(["0.10.0"]);

    h.deps.current = "0.10.0";
    await createUpdateService(h.deps).runBackgroundDownload();

    expect(await readdir(root)).toEqual([]);
  });

  test("a host that cannot replace itself downloads nothing", async () => {
    const { h } = await harness();
    h.deps.unsupported = "This host runs from source and cannot update itself.";
    const service = createUpdateService(h.deps);
    await service.runDueCheck();

    await service.runBackgroundDownload();

    expect(fileRequests(h.release.requests)).toEqual([]);
  });
});
