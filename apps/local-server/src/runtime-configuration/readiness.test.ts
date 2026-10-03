import { describe, expect, test } from "bun:test";
import {
  createRuntimeReadiness,
  READINESS_CACHE_MS,
  type ReadinessDeps,
  type ReadinessTarget,
  turnBlockReason,
} from "./readiness.ts";

const MODEL = {
  id: "m1",
  providerId: "p",
  description: "Model",
  model: "model",
  thinkingLevels: [],
  builtIn: false,
  position: 0,
  isDefault: true,
  defaultThinkingLevel: null,
};

const target = (overrides: Partial<ReadinessTarget> = {}): ReadinessTarget => ({
  id: "rtprov_1",
  name: "Wrapper",
  command: "cpe",
  driver: "claude-code",
  models: [MODEL],
  ...overrides,
});

/** A host where `installed` commands exist and answer `auth status` with `auth`. */
const host = (options: {
  installed?: string[];
  auth?: string | (() => string);
  version?: string;
  clock?: { now: number };
}) => {
  const calls: string[][] = [];
  const clock = options.clock ?? { now: 0 };
  const deps: ReadinessDeps = {
    locate: (command) => ((options.installed ?? []).includes(command) ? `/bin/${command}` : null),
    run: async (argv) => {
      calls.push(argv);
      if (argv[1] === "--version")
        return { exitCode: 0, output: options.version ?? "1.2.3 (Claude Code)" };
      const auth = typeof options.auth === "function" ? options.auth() : options.auth;
      if (auth === undefined) throw new Error("did not finish within 10s");
      return { exitCode: 0, output: auth };
    },
    now: () => clock.now,
  };
  return { readiness: createRuntimeReadiness(deps), calls, clock };
};

describe("runtime readiness", () => {
  test("a command found and logged in is ready, with its version", async () => {
    const { readiness } = host({ installed: ["cpe"], auth: '{"loggedIn": true}' });

    expect(await readiness.check(target())).toMatchObject({
      runtimeId: "rtprov_1",
      path: "/bin/cpe",
      version: "1.2.3",
      auth: "logged-in",
      ready: true,
      reason: null,
    });
  });

  test("a missing command is not ready and says so, without running anything", async () => {
    const { readiness, calls } = host({});

    expect(await readiness.check(target())).toMatchObject({
      path: null,
      auth: "unknown",
      ready: false,
      reason: "The command `cpe` was not found on this host's PATH.",
    });
    expect(calls).toEqual([]);
  });

  test("a logged-out command is not ready", async () => {
    const { readiness } = host({ installed: ["cpe"], auth: '{\n  "loggedIn": false\n}' });

    const status = await readiness.check(target());

    expect(status).toMatchObject({ auth: "logged-out", ready: false });
    expect(status.reason).toContain("not logged in");
  });

  test("a login it cannot read is unknown and does not block", async () => {
    for (const auth of ["Usage: cpe [options]", '{"user": "x"}', undefined]) {
      const { readiness } = host({ installed: ["cpe"], auth });
      expect(await readiness.check(target())).toMatchObject({ auth: "unknown", ready: true });
    }
  });

  test("a runtime with no models is not ready", async () => {
    const { readiness } = host({ installed: ["cpe"], auth: '{"loggedIn": true}' });

    expect(await readiness.check(target({ models: [] }))).toMatchObject({
      ready: false,
      reason: "It has no models: add one in AOP settings › Runtimes.",
    });
  });

  test("looks are kept for a minute per command, unless a fresh one is asked for", async () => {
    const { readiness, calls, clock } = host({ installed: ["cpe"], auth: '{"loggedIn": true}' });

    await readiness.check(target());
    await readiness.check(target({ id: "rtprov_2" }));
    expect(calls).toHaveLength(2);

    await readiness.check(target(), { fresh: true });
    expect(calls).toHaveLength(4);

    clock.now += READINESS_CACHE_MS;
    await readiness.check(target());
    expect(calls).toHaveLength(6);
  });

  test("a turn trusts a recent ready look, and looks again after a bad one", async () => {
    let auth = '{"loggedIn": false}';
    const { readiness, calls } = host({ installed: ["cpe"], auth: () => auth });

    expect(await readiness.blockReason("cpe", "claude-code")).toContain("not logged in");
    auth = '{"loggedIn": true}';
    expect(await readiness.blockReason("cpe", "claude-code")).toBeNull();
    const looked = calls.length;
    expect(await readiness.blockReason("cpe", "claude-code")).toBeNull();
    expect(calls).toHaveLength(looked);
  });
});

describe("turnBlockReason", () => {
  test("names the reason and where to fix it; a session with no command uses the driver's own", async () => {
    const { readiness } = host({ installed: ["claude"], auth: '{"loggedIn": true}' });

    expect(await turnBlockReason(null, "claude-code", readiness)).toBeNull();
    const blocked = await turnBlockReason("/opt/missing", "claude-code", readiness);
    expect(blocked).toContain("This turn could not start on its runtime.");
    expect(blocked).toContain("`/opt/missing` was not found");
    expect(blocked).toContain("AOP settings › Runtimes");
  });
});
