import { describe, expect, mock, test } from "bun:test";
import { CLIENT_HEADER, parseClientHeader } from "@aop/common";
import {
  clientHeaderValue,
  type HeaderSession,
  installClientHeader,
  withClientHeader,
} from "./client-header";

const VALUE = clientHeaderValue("0.10.8-nightly.20261003.4", "darwin");
const HOST = "https://soulf.tailffbdec.ts.net:25650";

describe("clientHeaderValue", () => {
  test("names the desktop app, its version and its platform, as the host reads it", () => {
    expect(VALUE).toBe("desktop; version=0.10.8-nightly.20261003.4; platform=darwin");
    expect(parseClientHeader(VALUE)).toEqual({
      app: "desktop",
      version: "0.10.8-nightly.20261003.4",
      platform: "darwin",
    });
  });
});

describe("withClientHeader", () => {
  test("adds the header to each call, keeping the headers the call had", async () => {
    const fetchImpl = mock(async (_input: string, _init?: RequestInit) => new Response("{}"));

    await withClientHeader(fetchImpl, VALUE)(`${HOST}/api/auth/me`, {
      headers: { Authorization: "Bearer aop_t" },
    });
    await withClientHeader(fetchImpl, VALUE)(`${HOST}/api/health`);

    const [first, second] = fetchImpl.mock.calls.map(([, init]) => new Headers(init?.headers));
    expect(first?.get(CLIENT_HEADER)).toBe(VALUE);
    expect(first?.get("authorization")).toBe("Bearer aop_t");
    expect(second?.get(CLIENT_HEADER)).toBe(VALUE);
  });
});

describe("installClientHeader", () => {
  const install = (hostOrigin: string | null) => {
    let listener: Parameters<HeaderSession["webRequest"]["onBeforeSendHeaders"]>[1] | null = null;
    const session: HeaderSession = {
      webRequest: {
        onBeforeSendHeaders: (_filter, given) => {
          listener = given;
        },
      },
    };
    installClientHeader(session, () => hostOrigin, VALUE);
    return (url: string): Record<string, string> => {
      let sent: Record<string, string> = {};
      listener?.({ url, requestHeaders: { Accept: "*/*" } }, ({ requestHeaders }) => {
        sent = requestHeaders;
      });
      return sent;
    };
  };

  test("adds the header to the dashboard's requests to the host it is connected to", () => {
    const send = install(HOST);

    expect(send(`${HOST}/api/projects`)).toEqual({ Accept: "*/*", [CLIENT_HEADER]: VALUE });
    expect(send(`${HOST}/api/events?x=1`)[CLIENT_HEADER]).toBe(VALUE);
  });

  test("leaves every other site's requests alone", () => {
    const send = install(HOST);

    expect(send("https://avatars.githubusercontent.com/u/1")).toEqual({ Accept: "*/*" });
    expect(send("https://soulf.tailffbdec.ts.net:443/api/projects")).toEqual({ Accept: "*/*" });
    expect(send("not a url")).toEqual({ Accept: "*/*" });
  });

  test("adds nothing while the app has no host", () => {
    expect(install(null)(`${HOST}/api/projects`)).toEqual({ Accept: "*/*" });
  });
});
