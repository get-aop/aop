import { describe, expect, test } from "bun:test";
import { feedConfigFromEnv, fetchLatestRelease } from "./release-feed.ts";
import { serve } from "./test-utils.ts";

describe("release feed", () => {
  test("defaults to GitHub and follows the environment", () => {
    expect(feedConfigFromEnv({})).toEqual({
      apiUrl: "https://api.github.com",
      repo: "get-aop/aop-mono",
    });
    expect(feedConfigFromEnv({ AOP_GITHUB_API_URL: "http://x", AOP_GITHUB_REPO: "a/b" })).toEqual({
      apiUrl: "http://x",
      repo: "a/b",
    });
  });

  test("turns a feed that answers badly into a message", async () => {
    const down = serve(() => new Response("nope", { status: 403 }));
    const junk = serve(() => Response.json({ hello: "world" }));
    const draft = serve(() => Response.json({ tag_name: "v1.0.0", html_url: "x", draft: true }));

    await expect(fetchLatestRelease({ apiUrl: down.url, repo: "a/b" })).rejects.toThrow(
      "answered 403",
    );
    await expect(fetchLatestRelease({ apiUrl: junk.url, repo: "a/b" })).rejects.toThrow(
      "did not describe a published release",
    );
    await expect(fetchLatestRelease({ apiUrl: draft.url, repo: "a/b" })).rejects.toThrow(
      "did not describe a published release",
    );
    for (const f of [down, junk, draft]) f.stop();
  });
});
