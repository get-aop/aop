import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SLACK_OAUTH_CALLBACK_PATH, slackAppManifestYaml } from "@aop/common";
import { FAKE_SLACK_TOKENS, type FakeSlack, startFakeSlack } from "./fake-slack.ts";
import { createSlackSignIn, type SlackSignIn } from "./sign-in.ts";
import { createSlackWebApi } from "./web-api.ts";

const REDIRECT = `https://host.tailnet.ts.net:25650${SLACK_OAUTH_CALLBACK_PATH}`;
const INPUT = {
  clientId: FAKE_SLACK_TOKENS.clientId,
  appToken: FAKE_SLACK_TOKENS.app,
  redirectUrl: REDIRECT,
};

describe("signing in with Slack (PKCE)", () => {
  let slack: FakeSlack;
  let signIn: SlackSignIn;
  let clock: number;

  beforeEach(() => {
    slack = startFakeSlack();
    clock = Date.now();
    signIn = createSlackSignIn({ api: createSlackWebApi({ url: slack.apiUrl }), now: () => clock });
  });
  afterEach(() => slack.stop());

  /** Opens Slack's "Allow" page and follows Allow (or Cancel) to the callback's query. */
  const allow = async (authorizeUrl: string, choice: "allow" | "cancel" = "allow") => {
    const page = await (await fetch(authorizeUrl)).text();
    const link = new RegExp(`data-testid="fake-slack-${choice}" href="([^"]+)"`).exec(page)?.[1];
    if (!link) throw new Error(page);
    const back = new URL(link.replace(/&amp;/g, "&"));
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    return Object.fromEntries(back.searchParams);
  };

  test("asks for the user scopes with an S256 challenge and redeems the code with no secret", async () => {
    const begun = await signIn.begin(INPUT);
    if ("error" in begun) throw new Error(begun.error);
    const url = new URL(begun.authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${slack.origin}/oauth/v2/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("user_scope")).toContain("im:history");

    const tokens = await signIn.finish(await allow(begun.authorizeUrl));
    expect(tokens).toEqual({ userToken: FAKE_SLACK_TOKENS.user, appToken: FAKE_SLACK_TOKENS.app });
    const exchange = slack.calls.find((call) => call.method === "oauth.v2.access");
    expect(exchange?.params.client_secret).toBeUndefined();
    expect(exchange?.params.code_verifier).toBeString();
  });

  test("a state is used once and lasts ten minutes", async () => {
    const begun = await signIn.begin(INPUT);
    if ("error" in begun) throw new Error(begun.error);
    const query = await allow(begun.authorizeUrl);
    await signIn.finish(query);
    expect(await signIn.finish(query)).toEqual({
      error: "This sign-in link has expired or was already used. Start again in AOP.",
    });

    const late = await signIn.begin(INPUT);
    if ("error" in late) throw new Error(late.error);
    clock += 11 * 60 * 1000;
    expect("error" in (await signIn.finish(await allow(late.authorizeUrl)))).toBe(true);
    expect(await signIn.finish({ code: "x", state: "forged" })).toMatchObject({
      error: expect.stringContaining("expired"),
    });
  });

  test("says when the person cancels, or a token or callback is wrong", async () => {
    const begun = await signIn.begin(INPUT);
    if ("error" in begun) throw new Error(begun.error);
    expect(await signIn.finish(await allow(begun.authorizeUrl, "cancel"))).toEqual({
      error: "Slack did not sign you in (access_denied).",
    });
    expect(await signIn.begin({ ...INPUT, appToken: "xapp-wrong" })).toMatchObject({
      error: expect.stringContaining("invalid_auth"),
    });
    expect(
      await signIn.begin({ ...INPUT, redirectUrl: "https://evil.example/collect" }),
    ).toMatchObject({ error: expect.stringContaining("sign-in callback") });
  });

  test("the manifest turns PKCE and Socket Mode on and lists the callback", () => {
    const manifest = slackAppManifestYaml([REDIRECT]);
    expect(manifest).toContain(`  redirect_urls:\n    - ${REDIRECT}\n  pkce_enabled: true`);
    expect(manifest).toContain("socket_mode_enabled: true");
    expect(manifest).toContain("token_rotation_enabled: false");
  });
});
