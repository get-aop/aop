import { describe, expect, test } from "bun:test";
import { isLoopbackUrl, parseHostUrl } from "./host-url";

const accepted = (input: string): string => {
  const result = parseHostUrl(input);
  if (!result.ok) throw new Error(`expected ${input} to be accepted: ${result.message}`);
  return result.url;
};

const refusal = (input: string): string => {
  const result = parseHostUrl(input);
  if (result.ok) throw new Error(`expected ${input} to be refused, got ${result.url}`);
  return result.message;
};

describe("parseHostUrl", () => {
  test("reduces a Tailscale address to its origin", () => {
    expect(accepted("https://mac.tail1234.ts.net")).toBe("https://mac.tail1234.ts.net");
    expect(accepted("  https://mac.tail1234.ts.net/  ")).toBe("https://mac.tail1234.ts.net");
    expect(accepted("https://mac.tail1234.ts.net/projects/abc?x=1#top")).toBe(
      "https://mac.tail1234.ts.net",
    );
    expect(accepted("HTTPS://Mac.Tail1234.ts.net:443")).toBe("https://mac.tail1234.ts.net");
  });

  test("assumes HTTPS for an address typed without a scheme", () => {
    expect(accepted("mac.tail1234.ts.net")).toBe("https://mac.tail1234.ts.net");
    expect(accepted("aop.example.com:8443")).toBe("https://aop.example.com:8443");
  });

  test("keeps a non-default port", () => {
    expect(accepted("https://mac.tail1234.ts.net:8443/")).toBe("https://mac.tail1234.ts.net:8443");
  });

  test("allows plain HTTP only to a host on this computer", () => {
    expect(accepted("http://127.0.0.1:25150")).toBe("http://127.0.0.1:25150");
    expect(accepted("http://localhost:25150/")).toBe("http://localhost:25150");
    expect(accepted("http://[::1]:25150")).toBe("http://[::1]:25150");
    expect(accepted("localhost:25150")).toBe("http://localhost:25150");
    expect(accepted("127.0.0.1:25150")).toBe("http://127.0.0.1:25150");
  });

  test("refuses plain HTTP to anything on a network, private or not, and says how to get HTTPS", () => {
    for (const input of [
      "http://mac.tail1234.ts.net",
      "http://192.168.1.20:25150",
      "http://100.64.0.5:25150",
      "http://example.com",
    ]) {
      expect(refusal(input)).toContain("https://");
    }
  });

  test("refuses schemes that are not web addresses", () => {
    expect(refusal("ftp://mac.tail1234.ts.net")).toContain("ftp");
    expect(refusal("app://aop")).toContain("app");
    expect(refusal("javascript://x")).toContain("javascript");
  });

  test("refuses credentials in the address, which would end up in logs", () => {
    expect(refusal("https://me:secret@mac.tail1234.ts.net")).toContain("user name");
  });

  test("refuses what is not an address", () => {
    expect(refusal("")).toContain("Enter");
    expect(refusal("   ")).toContain("Enter");
    expect(refusal("https://")).toContain("valid");
    expect(refusal("http://")).toContain("valid");
    expect(refusal("not a host name")).toContain("valid");
  });
});

describe("isLoopbackUrl", () => {
  test("is true only for this computer", () => {
    expect(isLoopbackUrl("http://127.0.0.1:25150")).toBe(true);
    expect(isLoopbackUrl("http://localhost:1")).toBe(true);
    expect(isLoopbackUrl("https://mac.tail1234.ts.net")).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1.evil.example")).toBe(false);
    expect(isLoopbackUrl("garbage")).toBe(false);
  });
});
