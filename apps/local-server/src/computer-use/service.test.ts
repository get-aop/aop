import { describe, expect, test } from "bun:test";
import { createComputerUseService } from "./service.ts";
import { CUA_PATH, fakeCua } from "./test-utils.ts";

const ON_CUA = { id: "proj_1", computerUse: "cua" } as const;
const CUA_SERVERS = {
  "cua-driver": { type: "stdio" as const, command: CUA_PATH, args: ["mcp"] },
};

describe("computer use service", () => {
  test("gives a thread of a project on CUA the driver's MCP server, by its absolute path", async () => {
    const service = createComputerUseService(fakeCua());

    expect(await service.serversFor(ON_CUA, "thread")).toEqual(CUA_SERVERS);
  });

  test("gives the coordinator nothing, and a project on the model's default nothing", async () => {
    const deps = fakeCua();
    const service = createComputerUseService(deps);

    expect(await service.serversFor(ON_CUA, "coordinator")).toBeUndefined();
    expect(
      await service.serversFor({ id: "proj_1", computerUse: "model-default" }, "thread"),
    ).toBeUndefined();
    // Neither had a reason to ask the driver anything.
    expect(deps.calls).toEqual([]);
  });

  test.each([
    ["not installed", fakeCua({}, { locate: () => null })],
    ["not answering", fakeCua({ version: new Error("timed out") })],
    ["not running", fakeCua({ permissions: JSON.stringify({ daemon_running: false }) })],
    [
      "missing a grant",
      fakeCua({ permissions: JSON.stringify({ accessibility: false, screen_recording: true }) }),
    ],
  ])("a host whose driver is %s starts the thread without the tools", async (_, deps) => {
    const service = createComputerUseService(deps);

    expect(await service.serversFor(ON_CUA, "thread")).toBeUndefined();
  });

  test("reuses a probe for a few seconds, and probes again when asked or once it is old", async () => {
    let clock = 0;
    const deps = fakeCua();
    const service = createComputerUseService(deps, () => clock);
    const probes = () => deps.calls.filter((argv) => argv[1] === "--version").length;

    await service.serversFor(ON_CUA, "thread");
    await service.cuaStatus();
    expect(probes()).toBe(1);

    await service.cuaStatus({ fresh: true });
    expect(probes()).toBe(2);

    clock = 10_000;
    await service.serversFor(ON_CUA, "thread");
    expect(probes()).toBe(3);
  });

  test("calls that arrive while a probe runs share it", async () => {
    const deps = fakeCua();
    const service = createComputerUseService(deps);

    const statuses = await Promise.all([
      service.cuaStatus({ fresh: true }),
      service.cuaStatus({ fresh: true }),
      service.serversFor(ON_CUA, "thread"),
    ]);

    expect(deps.calls.filter((argv) => argv[1] === "--version")).toHaveLength(1);
    expect(statuses[0]).toBe(statuses[1]);
  });
});
