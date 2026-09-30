import { describe, expect, test } from "bun:test";
import {
  type ConfigStore,
  createConfigStore,
  type DesktopConfig,
  defaultConfig,
} from "../host-config/config-store";
import { createFakeKeychain, createMemoryFile } from "../host-config/test-utils";
import {
  createTokenStore,
  type EncryptedTokens,
  type TokenStore,
} from "../host-config/token-store";
import { type ConnectDeps, connectToHost, forgetHost } from "./connect-host";
import type { HostClient } from "./host-client";
import { fakeHostClient, HOST } from "./test-utils";

const setup = (client: HostClient = fakeHostClient(), keychainAvailable = true) => {
  const { keychain } = createFakeKeychain(keychainAvailable);
  const tokens: TokenStore = createTokenStore(keychain, createMemoryFile<EncryptedTokens>({}));
  const config: ConfigStore = createConfigStore(createMemoryFile<DesktopConfig>(defaultConfig()));
  const requestedHosts: string[] = [];
  const deps: ConnectDeps = {
    tokens,
    config,
    clientFor: (hostUrl) => {
      requestedHosts.push(hostUrl);
      return client;
    },
    clientApiVersion: 1,
  };
  return { deps, tokens, config, requestedHosts };
};

const input = { url: HOST, code: "K7QM-4XNP", deviceName: "Work laptop" };

describe("connectToHost", () => {
  test("pairs, keeps the token in the keychain and remembers the host", async () => {
    const { deps, tokens, config } = setup();

    expect(await connectToHost(deps, input)).toEqual({ ok: true });

    expect(await tokens.load(HOST)).toBe("aop_new_token");
    expect(await config.load()).toMatchObject({
      mode: "remote",
      remoteUrl: HOST,
      deviceName: "Work laptop",
    });
  });

  test("talks to the origin of what was typed, not to the typed text", async () => {
    const { deps, requestedHosts } = setup();

    await connectToHost(deps, { ...input, url: "  mac.tail1234.ts.net/projects?x=1 " });

    expect(requestedHosts).toEqual([HOST]);
  });

  test("refuses an address the app cannot use, before any network call", async () => {
    const { deps, requestedHosts } = setup();

    const result = await connectToHost(deps, { ...input, url: "http://192.168.1.20:25150" });

    expect(result).toMatchObject({ ok: false, code: "invalid-url" });
    expect(requestedHosts).toEqual([]);
  });

  test("checks the keychain before spending the pairing code, and saves nothing", async () => {
    let paired = false;
    const { deps, config } = setup(
      fakeHostClient({
        pair: async () => {
          paired = true;
          return { status: "paired", token: "t" };
        },
      }),
      false,
    );

    const result = await connectToHost(deps, input);

    expect(result).toMatchObject({ ok: false, code: "keychain-unavailable" });
    expect(paired).toBe(false);
    expect((await config.load()).mode).toBeNull();
  });

  test("does not pair with something that is not an AOP host", async () => {
    let paired = false;
    const { deps } = setup(
      fakeHostClient({
        health: async () => ({ status: "not-aop" }),
        pair: async () => {
          paired = true;
          return { status: "paired", token: "t" };
        },
      }),
    );

    expect(await connectToHost(deps, input)).toMatchObject({ ok: false, code: "not-aop" });
    expect(paired).toBe(false);
  });

  test("does not pair across an API version the app cannot speak, and says which side to update", async () => {
    const health = (apiVersion: number, minClientApiVersion: number) => async () => ({
      status: "ok" as const,
      health: { service: "aop" as const, version: "9", apiVersion, minClientApiVersion },
    });
    const tooNew = setup(fakeHostClient({ health: health(5, 4) }));
    const tooOld = setup(fakeHostClient({ health: health(0, 0) }));

    const appTooOld = await connectToHost(tooNew.deps, input);
    const hostTooOld = await connectToHost(tooOld.deps, input);

    expect(appTooOld).toMatchObject({ ok: false, code: "client-too-old" });
    expect(appTooOld.ok === false && appTooOld.message).toContain("Update the app");
    expect(hostTooOld).toMatchObject({ ok: false, code: "host-too-old" });
    expect(hostTooOld.ok === false && hostTooOld.message).toContain("on the host");
  });

  test("reports an unreachable host with the reason", async () => {
    const { deps } = setup(
      fakeHostClient({
        health: async () => ({
          status: "unreachable",
          message: "The host did not answer in time.",
          failure: "timeout",
        }),
      }),
    );

    expect(await connectToHost(deps, input)).toEqual({
      ok: false,
      code: "unreachable",
      message: "The host did not answer in time.",
    });
  });

  test("a wrong code saves nothing, and a rate limit says how long to wait", async () => {
    const wrong = setup(fakeHostClient({ pair: async () => ({ status: "wrong-code" }) }));
    const limited = setup(
      fakeHostClient({ pair: async () => ({ status: "rate-limited", retryAfterSeconds: 30 }) }),
    );

    expect(await connectToHost(wrong.deps, input)).toMatchObject({ code: "wrong-code" });
    expect(await wrong.tokens.load(HOST)).toBeNull();
    expect((await wrong.config.load()).mode).toBeNull();
    const rateLimited = await connectToHost(limited.deps, input);
    expect(rateLimited).toMatchObject({ code: "rate-limited" });
    expect(rateLimited.ok === false && rateLimited.message).toContain("30 seconds");
  });

  test("asks for a code and a device name instead of sending an empty pairing", async () => {
    const { deps, requestedHosts } = setup();

    expect(await connectToHost(deps, { ...input, code: "  " })).toMatchObject({
      ok: false,
      code: "wrong-code",
    });
    expect(await connectToHost(deps, { ...input, deviceName: "" })).toMatchObject({ ok: false });
    expect(requestedHosts).toEqual([]);
  });

  test("trims the code and the name it sends", async () => {
    const sent: string[] = [];
    const { deps } = setup(
      fakeHostClient({
        pair: async (code, name) => {
          sent.push(code, name);
          return { status: "paired", token: "t" };
        },
      }),
    );

    await connectToHost(deps, { ...input, code: " K7QM-4XNP ", deviceName: " Work laptop " });

    expect(sent).toEqual(["K7QM-4XNP", "Work laptop"]);
  });
});

describe("forgetHost", () => {
  test("signs this device out of the host, drops its token and clears the choice", async () => {
    const signedOut: string[] = [];
    const { deps, tokens, config } = setup(
      fakeHostClient({ signOut: async (token) => void signedOut.push(token) }),
    );
    await connectToHost(deps, input);

    await forgetHost(deps);

    expect(signedOut).toEqual(["aop_new_token"]);
    expect(await tokens.load(HOST)).toBeNull();
    expect(await config.load()).toMatchObject({ mode: null, remoteUrl: null });
  });

  test("still forgets the host when it cannot be told", async () => {
    const { deps, tokens, config } = setup(
      fakeHostClient({
        signOut: async () => {
          throw new Error("offline");
        },
      }),
    );
    await connectToHost(deps, input);

    await forgetHost(deps).catch(() => undefined);

    expect(await tokens.load(HOST)).toBeNull();
    expect((await config.load()).mode).toBeNull();
  });

  test("does nothing to a host that was never set up", async () => {
    const { deps, config } = setup();

    await forgetHost(deps);

    expect(await config.load()).toEqual(defaultConfig());
  });
});
