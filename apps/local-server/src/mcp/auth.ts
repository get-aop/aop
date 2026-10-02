import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { readMcpSecret, rotateMcpSecretFile } from "./secret.ts";

/**
 * MCP URL tokens: an HMAC of the chat session id under the host's MCP secret (see secret.ts).
 * The secret is kept in the AOP home, so a token handed to a run stays valid when the host
 * restarts under it; rotating the secret is what invalidates every token at once. Whether the
 * session may still use its token is checked separately, on every request (routes.ts).
 */

export const createAuthenticatedMcpUrl = (baseUrl: string, chatSessionId: string): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("sessionId", chatSessionId);
  url.searchParams.set("accessToken", createAccessToken(chatSessionId));
  return url.toString();
};

export const hasValidMcpAccess = (
  chatSessionId: string | undefined,
  accessToken: string | undefined,
): boolean => {
  if (!chatSessionId || !accessToken) return false;

  const expected = Buffer.from(createAccessToken(chatSessionId));
  const actual = Buffer.from(accessToken);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

/** Replaces the secret: every token issued before stops working, on purpose. */
export const rotateMcpSecret = (): void => rotateMcpSecretFile(mcpSecretPath());

/** Where the secret lives: in the AOP home, readable by its owner only. */
export const mcpSecretPath = (): string => join(aopPaths.home(), "mcp-secret");

const createAccessToken = (chatSessionId: string): string =>
  createHmac("sha256", readMcpSecret(mcpSecretPath())).update(chatSessionId).digest("base64url");
