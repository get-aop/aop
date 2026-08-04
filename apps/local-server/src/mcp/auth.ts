import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const mcpAccessSecret = randomBytes(32);

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

const createAccessToken = (chatSessionId: string): string =>
  createHmac("sha256", mcpAccessSecret).update(chatSessionId).digest("base64url");
