import { afterEach, describe, expect, mock, test } from "bun:test";
import type { LocalServerContext } from "../../context.ts";
import { SettingKey } from "../../settings/types.ts";
import { getLinearAccessToken } from "./access-token.ts";

const originalFetch = globalThis.fetch;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("integrations/linear/access-token", () => {
  test("refreshes expired stored OAuth tokens before returning an access token", async () => {
    const expiredTokens = {
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: "2000-01-01T00:00:00.000Z",
    };
    const freshTokens = {
      accessToken: "fresh-access-token",
      refreshToken: "fresh-refresh-token",
      expiresIn: 3600,
    };
    const save = mock(async () => {});
    const fetchMock = mock(async (_input: FetchInput, _init?: FetchInit) =>
      Response.json({
        access_token: freshTokens.accessToken,
        refresh_token: freshTokens.refreshToken,
        expires_in: freshTokens.expiresIn,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const token = await getLinearAccessToken({
      linearTokenStore: {
        save,
        getStatus: async () => ({ connected: true, locked: false }),
        unlock: async () => {},
        read: async () => expiredTokens,
        lock: async () => {},
        disconnect: async () => {},
      },
      settingsRepository: {
        get: async (key: SettingKey) =>
          key === SettingKey.LINEAR_CLIENT_ID ? "linear-client-id" : "",
      },
    } as unknown as LocalServerContext);

    expect(token).toBe("fresh-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.linear.app/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
        body: new URLSearchParams({
          client_id: "linear-client-id",
          grant_type: "refresh_token",
          refresh_token: "refresh-token",
        }).toString(),
      }),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
      }),
    );
  });
});
