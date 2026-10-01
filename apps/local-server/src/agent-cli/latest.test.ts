import { describe, expect, test } from "bun:test";
import { fetchLatestCliVersion } from "./latest.ts";
import { testCli } from "./test-utils.ts";

const cli = testCli();
const tags = { latest: "2.1.286", stable: "2.1.285", next: "2.2.0-beta.1" };

const answering = (status: number, body: unknown) => {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { urls, fetch };
};

describe("fetchLatestCliVersion", () => {
  test("reads the channel's dist-tag of the CLI's npm package", async () => {
    const registry = answering(200, tags);
    expect(await fetchLatestCliVersion(cli, "latest", { fetch: registry.fetch })).toBe("2.1.286");
    expect(await fetchLatestCliVersion(cli, "stable", { fetch: registry.fetch })).toBe("2.1.285");
    expect(registry.urls[0]).toBe(
      "https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags",
    );
  });

  test("asks another registry when one is given", async () => {
    const registry = answering(200, tags);
    await fetchLatestCliVersion(cli, "latest", {
      fetch: registry.fetch,
      registry: "http://127.0.0.1:4873/",
    });
    expect(registry.urls[0]).toBe(
      "http://127.0.0.1:4873/-/package/@anthropic-ai/claude-code/dist-tags",
    );
  });

  test("falls back to latest for a channel the registry does not have", async () => {
    const registry = answering(200, { latest: "2.1.286" });
    expect(await fetchLatestCliVersion(cli, "stable", { fetch: registry.fetch })).toBe("2.1.286");
  });

  test("throws on an error answer, a pre-release or a missing version", async () => {
    await expect(
      fetchLatestCliVersion(cli, "latest", { fetch: answering(503, {}).fetch }),
    ).rejects.toThrow("The npm registry answered 503");
    await expect(
      fetchLatestCliVersion(cli, "next", { fetch: answering(200, { next: "2.2.0-beta.1" }).fetch }),
    ).rejects.toThrow("named no next version");
    await expect(
      fetchLatestCliVersion(cli, "latest", { fetch: answering(200, {}).fetch }),
    ).rejects.toThrow("named no latest version");
  });

  test("gives up on a registry that does not answer in time", async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("The operation timed out.")),
        );
      });
    const started = Date.now();
    await expect(
      fetchLatestCliVersion(cli, "latest", { fetch: hanging, timeoutMs: 30 }),
    ).rejects.toThrow("timed out");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("an offline machine fails the check instead of breaking anything", async () => {
    await expect(
      fetchLatestCliVersion(cli, "latest", { registry: "http://127.0.0.1:9", timeoutMs: 2_000 }),
    ).rejects.toThrow();
  });
});
