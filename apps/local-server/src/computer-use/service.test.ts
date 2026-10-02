import { describe, expect, test } from "bun:test";
import { createComputerUseService } from "./service.ts";
import { CUA_PATH, fakeCua } from "./test-utils.ts";

const ON_CUA = { id: "proj_1", computerUse: "cua" } as const;
const CUA_SERVERS = { "cua-driver": { type: "stdio", command: CUA_PATH, args: ["mcp"] } };

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

  test("a driver that cannot serve leaves the thread without the tools instead of failing it", async () => {
    const missing = createComputerUseService(fakeCua(undefined, { locate: () => null }));
    const ungranted = createComputerUseService(
      fakeCua(JSON.stringify({ accessibility: false, screen_recording: true })),
    );

    expect(await missing.serversFor(ON_CUA, "thread")).toBeUndefined();
    expect(await ungranted.serversFor(ON_CUA, "thread")).toBeUndefined();
  });

  test("a driver whose app is not running still serves: the app starts on first use", async () => {
    const service = createComputerUseService(fakeCua(JSON.stringify({ daemon_running: false })));

    expect(await service.serversFor(ON_CUA, "thread")).toEqual(CUA_SERVERS);
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
});
