import { describe, expect, test } from "bun:test";
import type { AgentCliUpdate } from "@aop/common";
import { detectUpdatePlan, type UpdatePlan } from "./install-method.ts";
import type { CliProbe } from "./probe.ts";
import { isSpawnGateClosed } from "./spawn-gate.ts";
import { NATIVE_PATH, nativeProbe, npmProbe, testCli, waitUntil } from "./test-utils.ts";
import { checkWritable, type PlannedUpdate, runPlannedUpdate } from "./update-runner.ts";

const cli = testCli();

const planFor = (probe: CliProbe): UpdatePlan & { command: string[] } => {
  const plan = detectUpdatePlan(
    cli,
    { path: probe.path ?? "", realPath: probe.realPath ?? "" },
    "latest",
    () => false,
  );
  if (!plan.command) throw new Error("no command");
  return { ...plan, command: plan.command };
};

const harness = (input: {
  probe: CliProbe;
  after: CliProbe;
  activeRuns?: () => Promise<number>;
  exitCode?: number;
  latest?: string;
}) => {
  const changes: Partial<AgentCliUpdate>[] = [];
  const commands: string[][] = [];
  const gateDuringCommand: boolean[] = [];
  let stopped = false;
  const update: PlannedUpdate = {
    definition: cli,
    plan: planFor(input.probe),
    fromVersion: input.probe.version,
    latest: input.latest ?? "2.1.1",
  };
  const done = runPlannedUpdate(update, {
    activeRunCount: input.activeRuns ?? (async () => 0),
    runCommand: async (argv, onOutput) => {
      commands.push(argv);
      gateDuringCommand.push(isSpawnGateClosed(cli.provider));
      onOutput("working\n");
      return { exitCode: input.exitCode ?? 0, output: "done\n" };
    },
    reprobe: async () => input.after,
    onChange: (patch) => changes.push(patch),
    sleep: () => Bun.sleep(1),
    deferPollMs: 1,
    isStopped: () => stopped,
  });
  return {
    done,
    changes,
    commands,
    gateDuringCommand,
    stop: () => {
      stopped = true;
    },
    last: () => Object.assign({}, ...changes) as Partial<AgentCliUpdate>,
  };
};

describe("runPlannedUpdate", () => {
  test("a native update runs at once, with runs in flight, and holds new launches meanwhile", async () => {
    const run = harness({
      probe: nativeProbe("2.1.0"),
      after: nativeProbe("2.1.1"),
      activeRuns: async () => 3,
    });
    await run.done;

    expect(run.commands).toEqual([[NATIVE_PATH, "update"]]);
    expect(run.gateDuringCommand).toEqual([true]);
    expect(isSpawnGateClosed(cli.provider)).toBe(false);
    expect(run.changes.some((change) => change.state === "waiting")).toBe(false);
    expect(run.last()).toMatchObject({ state: "succeeded", toVersion: "2.1.1", error: null });
  });

  test("an npm update waits until no run is in flight, then runs", async () => {
    let active = 2;
    const run = harness({
      probe: npmProbe("2.1.0"),
      after: npmProbe("2.1.1"),
      activeRuns: async () => active,
    });
    await waitUntil(() => run.changes.some((change) => change.state === "waiting"));
    expect(run.commands).toEqual([]);
    expect(run.changes.find((change) => change.state === "waiting")?.deferredFor).toBe(2);
    // While it waits, launches are not held: the runs in flight may need follow-up turns.
    expect(isSpawnGateClosed(cli.provider)).toBe(false);

    active = 0;
    await run.done;
    expect(run.commands).toEqual([
      ["npm", "install", "--global", "@anthropic-ai/claude-code@latest"],
    ]);
    expect(run.gateDuringCommand).toEqual([true]);
    expect(run.last()).toMatchObject({ state: "succeeded", toVersion: "2.1.1" });
  });

  test("runs are counted only once new launches are held, so none slips in before the update", async () => {
    const gateWhenCounted: boolean[] = [];
    const run = harness({
      probe: npmProbe("2.1.0"),
      after: npmProbe("2.1.1"),
      activeRuns: async () => {
        gateWhenCounted.push(isSpawnGateClosed(cli.provider));
        return 0;
      },
    });
    await run.done;
    expect(gateWhenCounted).toEqual([true]);
  });

  test("a run count that cannot be read is treated as runs in flight", async () => {
    let fail = true;
    const run = harness({
      probe: npmProbe("2.1.0"),
      after: npmProbe("2.1.1"),
      activeRuns: async () => {
        if (fail) throw new Error("database busy");
        return 0;
      },
    });
    await waitUntil(() => run.changes.some((change) => change.state === "waiting"));
    expect(run.commands).toEqual([]);
    fail = false;
    await run.done;
    expect(run.commands).toHaveLength(1);
  });

  test("a host that stops while the update waits gives the update up", async () => {
    const run = harness({
      probe: npmProbe("2.1.0"),
      after: npmProbe("2.1.1"),
      activeRuns: async () => 1,
    });
    await waitUntil(() => run.changes.some((change) => change.state === "waiting"));
    run.stop();
    await run.done;
    expect(run.commands).toEqual([]);
    expect(run.last()).toMatchObject({
      state: "failed",
      error: expect.stringContaining("stopped"),
    });
  });

  test("a command that fails reports its exit code and the command to run by hand", async () => {
    const run = harness({ probe: npmProbe("2.1.0"), after: npmProbe("2.1.0"), exitCode: 243 });
    await run.done;
    expect(run.last()).toMatchObject({
      state: "failed",
      error: "`npm install --global @anthropic-ai/claude-code@latest` exited with code 243",
      manualCommand: "npm install --global @anthropic-ai/claude-code@latest",
      output: "done\n",
    });
    expect(isSpawnGateClosed(cli.provider)).toBe(false);
  });

  test("a command that succeeds but leaves the old version is a failure that says so", async () => {
    const run = harness({ probe: nativeProbe("2.1.0"), after: nativeProbe("2.1.0") });
    await run.done;
    expect(run.last()).toMatchObject({
      state: "failed",
      error: expect.stringContaining("still on 2.1.0 (2.1.1 is out)"),
      manualCommand: "claude update",
    });
  });

  test("a CLI that no longer answers after the update is a failure", async () => {
    const run = harness({ probe: nativeProbe("2.1.0"), after: nativeProbe(null) });
    await run.done;
    expect(run.last()).toMatchObject({
      state: "failed",
      error: expect.stringContaining("no longer reports a version"),
    });
  });

  test("streams the command's output while it runs", async () => {
    const run = harness({ probe: nativeProbe("2.1.0"), after: nativeProbe("2.1.1") });
    await run.done;
    expect(run.changes.some((change) => change.output === "working\n")).toBe(true);
  });
});

describe("checkWritable", () => {
  const npm = planFor(npmProbe("2.1.0"));

  test("refuses a package manager install the user cannot write to, without sudo", async () => {
    const error = await checkWritable(npm, npmProbe("2.1.0").realPath ?? "", async () => false);
    expect(error).toBe(
      "/usr/local/lib/node_modules is not writable by this user, and AOP never updates with sudo",
    );
  });

  test("allows a writable install, and never checks a native one", async () => {
    expect(await checkWritable(npm, npmProbe("2.1.0").realPath ?? "", async () => true)).toBeNull();
    const native = planFor(nativeProbe("2.1.0"));
    expect(
      await checkWritable(native, "/x", async () => {
        throw new Error("not called");
      }),
    ).toBeNull();
  });
});
