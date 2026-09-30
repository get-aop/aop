import { API_VERSION, checkHostCompatibility } from "@aop/common";
import type { ConnectErrorCode, ConnectInput, ConnectResult } from "../../src/backend/types";
import type { ConfigStore } from "../host-config/config-store";
import { parseHostUrl } from "../host-config/host-url";
import { KeychainUnavailableError, type TokenStore } from "../host-config/token-store";
import type { HostClient, PairResult } from "./host-client";

export interface ConnectDeps {
  tokens: TokenStore;
  config: ConfigStore;
  clientFor: (hostUrl: string) => HostClient;
  clientApiVersion?: number;
}

/**
 * The first-run flow: check the address, check the host speaks this app's API, trade the
 * pairing code for a device token, and keep the token in the keychain. Nothing is saved unless
 * every step succeeds, and the keychain is checked first so a code is never spent on a token
 * that would then have nowhere safe to go.
 */
export const connectToHost = async (
  deps: ConnectDeps,
  input: ConnectInput,
): Promise<ConnectResult> => {
  const parsed = parseHostUrl(input.url);
  if (!parsed.ok) return refusal("invalid-url", parsed.message);
  const code = input.code.trim();
  const deviceName = input.deviceName.trim();
  if (code === "") return refusal("wrong-code", "Enter the pairing code the host shows.");
  if (deviceName === "") return refusal("failed", "Give this device a name.");
  if (!deps.tokens.isAvailable()) {
    return refusal(
      "keychain-unavailable",
      "The operating system's keychain is not available, so this app cannot keep a device token safely.",
    );
  }

  const client = deps.clientFor(parsed.url);
  const unsuitable = await checkHost(client, deps.clientApiVersion ?? API_VERSION);
  if (unsuitable) return unsuitable;

  const paired = await client.pair(code, deviceName);
  if (paired.status !== "paired") return pairFailure(paired);

  try {
    await deps.tokens.save(parsed.url, paired.token);
  } catch (error) {
    // The keychain checked out a moment ago; the device is on the host's list and its owner can revoke it.
    return refusal(
      error instanceof KeychainUnavailableError ? "keychain-unavailable" : "failed",
      "This device was paired, but the token could not be stored. Remove the device on the host and try again.",
    );
  }
  await deps.config.update({ mode: "remote", remoteUrl: parsed.url, deviceName });
  return { ok: true };
};

/** Forgets a remote host: leaves the host's device list when it can, then drops the token. */
export const forgetHost = async (
  deps: Pick<ConnectDeps, "tokens" | "config" | "clientFor">,
): Promise<void> => {
  const { remoteUrl } = await deps.config.load();
  if (remoteUrl) {
    const token = await deps.tokens.load(remoteUrl);
    // Unpairing here keeps the host's device list honest; if the host is away the owner can revoke it there.
    if (token)
      await deps
        .clientFor(remoteUrl)
        .signOut(token)
        .catch(() => undefined);
    await deps.tokens.remove(remoteUrl);
  }
  await deps.config.update({ mode: null, remoteUrl: null });
};

const checkHost = async (
  client: HostClient,
  clientApiVersion: number,
): Promise<ConnectResult | null> => {
  const health = await client.health();
  if (health.status === "unreachable") return refusal("unreachable", health.message);
  if (health.status === "not-aop") {
    return refusal(
      "not-aop",
      "That address answered, but not as an AOP host. It may be too old to pair with this app.",
    );
  }
  const compatibility = checkHostCompatibility(health.health, clientApiVersion);
  if (compatibility.status === "client-too-old") {
    return refusal(
      "client-too-old",
      "This host needs a newer AOP app. Update the app, then try again.",
    );
  }
  if (compatibility.status === "host-too-old") {
    return refusal(
      "host-too-old",
      "This host is older than this app. Update AOP on the host, then try again.",
    );
  }
  return null;
};

const pairFailure = (result: Exclude<PairResult, { status: "paired" }>): ConnectResult => {
  switch (result.status) {
    case "wrong-code":
      return refusal("wrong-code", "Wrong or expired pairing code. Ask the host for a new one.");
    case "rate-limited":
      return refusal(
        "rate-limited",
        result.retryAfterSeconds
          ? `Too many wrong codes. Try again in ${result.retryAfterSeconds} seconds.`
          : "Too many wrong codes. Try again in a minute.",
      );
    case "unreachable":
      return refusal("unreachable", result.message);
    case "failed":
      return refusal("failed", result.message);
  }
};

const refusal = (code: ConnectErrorCode, message: string): ConnectResult => ({
  ok: false,
  code,
  message,
});
