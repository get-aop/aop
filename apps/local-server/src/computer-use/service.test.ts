import { describe, expect, test } from "bun:test";
import { createComputerUseService, cuaGateUrl } from "./service.ts";
import { fakeCua } from "./test-utils.ts";

const ON_CUA = { id: "proj_1", computerUse: "cua" } as const;
const AOP_URL = "http://127.0.0.1:25150/api/mcp?sessionId=thr_1&accessToken=t0k";
const CUA_SERVERS = {
  "cua-driver": {
    type: "http" as const,
    url: "http://127.0.0.1:25150/api/mcp/cua?sessionId=thr_1&accessToken=t0k",
  },
};

describe("computer use service", () => {
  test("gives a thread of a project on CUA the host's gate in front of the driver, with the session's token", async () => {
    const service = createComputerUseService(fakeCua());

    expect(await service.serversFor(ON_CUA, "thread", AOP_URL)).toEqual(CUA_SERVERS);
  });

  test("a run without an AOP MCP URL (a runtime without MCP) gets no gate", async () => {
    const service = createComputerUseService(fakeCua());

    expect(await service.serversFor(ON_CUA, "thread")).toBeUndefined();
  });

  test("the gate's URL keeps the session's query and one trailing slash at most", () => {
    expect(cuaGateUrl("http://h:1/api/mcp/?sessionId=s&accessToken=t")).toBe(
      "http://h:1/api/mcp/cua?sessionId=s&accessToken=t",
    );
  });

  test("gives the coordinator nothing, and a project on the model's default nothing", async () => {
    const deps = fakeCua();
    const service = createComputerUseService(deps);

    expect(await service.serversFor(ON_CUA, "coordinator", AOP_URL)).toBeUndefined();
    expect(
      await service.serversFor({ id: "proj_1", computerUse: "model-default" }, "thread", AOP_URL),
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

    expect(await service.serversFor(ON_CUA, "thread", AOP_URL)).toBeUndefined();
  });

  test("reuses a probe for a few seconds, and probes again when asked or once it is old", async () => {
    let clock = 0;
    const deps = fakeCua();
    const service = createComputerUseService(deps, () => clock);
    const probes = () => deps.calls.filter((argv) => argv[1] === "--version").length;

    await service.serversFor(ON_CUA, "thread", AOP_URL);
    await service.cuaStatus();
    expect(probes()).toBe(1);

    await service.cuaStatus({ fresh: true });
    expect(probes()).toBe(2);

    clock = 10_000;
    await service.serversFor(ON_CUA, "thread", AOP_URL);
    expect(probes()).toBe(3);
  });

  test("calls that arrive while a probe runs share it", async () => {
    const deps = fakeCua();
    const service = createComputerUseService(deps);

    const statuses = await Promise.all([
      service.cuaStatus({ fresh: true }),
      service.cuaStatus({ fresh: true }),
      service.serversFor(ON_CUA, "thread", AOP_URL),
    ]);

    expect(deps.calls.filter((argv) => argv[1] === "--version")).toHaveLength(1);
    expect(statuses[0]).toBe(statuses[1]);
  });
});
