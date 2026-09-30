import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeHost, makeUpdateStatus } from "../updates/test-utils";

setupDashboardDom();

const { ApiError } = await import("./request");
const { applyUpdate, checkForUpdate, getUpdateStatus } = await import("./updates");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("update API", () => {
  test("reads the status the host reports", async () => {
    const host = installFakeHost({ status: makeUpdateStatus({ latest: "0.11.0" }) });

    expect((await getUpdateStatus()).latest).toBe("0.11.0");
    expect(host.calls).toEqual(["GET /updates"]);
  });

  test("a check is a POST and returns the fresh status", async () => {
    const host = installFakeHost();

    expect((await checkForUpdate()).available).toBe(true);
    expect(host.calls).toEqual(["POST /updates/check"]);
  });

  test("a status the host shaped wrongly is refused", async () => {
    installFakeHost({ status: { enabled: "yes" } as never });

    await expect(getUpdateStatus()).rejects.toThrow();
  });

  test("applying resolves once started and surfaces a refusal with its status", async () => {
    installFakeHost();
    await applyUpdate();

    installFakeHost({ applyStatus: 403 });
    const error = await applyUpdate().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(403);
  });
});
