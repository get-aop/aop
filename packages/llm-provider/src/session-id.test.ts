import { describe, expect, test } from "bun:test";
import { sanitizeGrokSessionId, sanitizeSessionId } from "./session-id.ts";

describe("sanitizeSessionId", () => {
  test("accepts real-world session id shapes", () => {
    expect(sanitizeSessionId("0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f")).toBe(
      "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
    );
    expect(sanitizeSessionId("thread_abc123XYZ")).toBe("thread_abc123XYZ");
    expect(sanitizeSessionId("ses_8f2k3j4l5m")).toBe("ses_8f2k3j4l5m");
    expect(sanitizeSessionId("  padded-id-1  ")).toBe("padded-id-1");
  });

  test("rejects flag-shaped and path-shaped values", () => {
    expect(sanitizeSessionId("--config=evil")).toBeUndefined();
    expect(sanitizeSessionId("-x")).toBeUndefined();
    expect(sanitizeSessionId("../../etc/passwd")).toBeUndefined();
    expect(sanitizeSessionId("a/b")).toBeUndefined();
    expect(sanitizeSessionId("id with spaces")).toBeUndefined();
    expect(sanitizeSessionId("id;rm -rf")).toBeUndefined();
    expect(sanitizeSessionId("")).toBeUndefined();
    expect(sanitizeSessionId(undefined)).toBeUndefined();
    expect(sanitizeSessionId(`x${"a".repeat(300)}`)).toBeUndefined();
  });

  test("rejects AOP record ids", () => {
    expect(sanitizeSessionId("isess_01kxmsfkf7exxrgvv1qsfjzyrh")).toBeUndefined();
    expect(sanitizeSessionId("crun_01kxmxetvae00b7h0x5hrsevqw")).toBeUndefined();
  });
});

describe("sanitizeGrokSessionId", () => {
  test("accepts UUID session ids and rejects broader provider ids", () => {
    expect(sanitizeGrokSessionId("0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f")).toBe(
      "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
    );
    expect(sanitizeGrokSessionId("thread_abc123XYZ")).toBeUndefined();
    expect(sanitizeGrokSessionId("not-a-uuid")).toBeUndefined();
  });
});
