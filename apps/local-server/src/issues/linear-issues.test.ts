import { describe, expect, test } from "bun:test";
import { createLinearIssueLoader } from "./linear-issues.ts";
import { linearConnection, linearNode, scriptedLinear } from "./test-utils.ts";

const request = {
  projectId: "proj_1",
  connection: linearConnection(),
  state: "open" as const,
  limit: 100,
  refresh: false,
};

describe("the Linear issue loader", () => {
  test("holds a read for a minute; a refresh reads again", async () => {
    let now = 0;
    const { api, keys } = scriptedLinear([linearNode()]);
    const loader = createLinearIssueLoader(api, { now: () => now });

    await loader.load(request);
    now += 30_000;
    await loader.load(request);
    expect(keys).toHaveLength(1);
    await loader.load({ ...request, refresh: true });
    expect(keys).toHaveLength(2);
  });

  test("a new team or project reads again, as does a forgotten project", async () => {
    const { api, keys } = scriptedLinear();
    const loader = createLinearIssueLoader(api);

    await loader.load(request);
    await loader.load({
      ...request,
      connection: linearConnection({ scope: { kind: "project", id: "p9", name: "Beta" } }),
    });
    loader.forget("proj_1");
    await loader.load(request);

    expect(keys).toHaveLength(3);
  });

  test("a refused key keeps what was held and says it was refused", async () => {
    let now = 0;
    const { api } = scriptedLinear();
    const loader = createLinearIssueLoader(api, { now: () => now });

    await loader.load(request);
    now += 120_000;
    const read = await loader.load({
      ...request,
      connection: linearConnection({ apiKey: "revoked" }),
    });

    expect(read.failure).toEqual({ unauthorized: true, message: "Linear refused the API key" });
    expect(read.issues.map((issue) => issue.identifier)).toEqual(["ENG-7"]);
  });
});
