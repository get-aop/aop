import { describe, expect, test } from "bun:test";
import { readHostVersion, waitForHostVersion, waitUntilHostDown } from "./host-probe.ts";
import { serve } from "./test-utils.ts";

describe("host probe", () => {
  test("reads the version a host reports and waits for the one it needs", async () => {
    let version = "0.9.51+abc1234";
    const host = serve(() => Response.json({ ok: true, version }));

    expect(await readHostVersion(host.port)).toBe("0.9.51+abc1234");
    expect(await waitForHostVersion(host.port, "0.10.0", 30, { intervalMs: 5 })).toBe(false);
    version = "0.10.0+def5678";
    expect(await waitForHostVersion(host.port, "0.10.0", 500, { intervalMs: 5 })).toBe(true);
    host.stop();
  });

  test("sees a host go away", async () => {
    const host = serve(() => Response.json({ version: "0.9.51" }));
    expect(await waitUntilHostDown(host.port, 30, { intervalMs: 5 })).toBe(false);

    host.stop();

    expect(await readHostVersion(host.port)).toBeNull();
    expect(await waitUntilHostDown(host.port, 500, { intervalMs: 5 })).toBe(true);
  });
});
