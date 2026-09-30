import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getAllowedOrigins, getBindHost } from "./config.ts";

describe("config", () => {
  let savedBindHost: string | undefined;
  let savedAllowedOrigins: string | undefined;

  beforeEach(() => {
    savedBindHost = process.env.AOP_BIND_HOST;
    savedAllowedOrigins = process.env.AOP_ALLOWED_ORIGINS;
    delete process.env.AOP_BIND_HOST;
    delete process.env.AOP_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    restore("AOP_BIND_HOST", savedBindHost);
    restore("AOP_ALLOWED_ORIGINS", savedAllowedOrigins);
  });

  describe("getBindHost", () => {
    test("listens on loopback unless told otherwise", () => {
      expect(getBindHost()).toBe("127.0.0.1");
      process.env.AOP_BIND_HOST = "  ";
      expect(getBindHost()).toBe("127.0.0.1");
    });

    test("honors AOP_BIND_HOST", () => {
      process.env.AOP_BIND_HOST = " 0.0.0.0 ";

      expect(getBindHost()).toBe("0.0.0.0");
    });
  });

  describe("getAllowedOrigins", () => {
    test("is empty by default", () => {
      expect(getAllowedOrigins()).toEqual([]);
    });

    test("reads a comma-separated list and reduces each entry to its origin", () => {
      process.env.AOP_ALLOWED_ORIGINS =
        "https://mac.tail1234.ts.net/, http://192.168.1.20:25150/dashboard ,,";

      expect(getAllowedOrigins()).toEqual([
        "https://mac.tail1234.ts.net",
        "http://192.168.1.20:25150",
      ]);
    });

    test("refuses an entry that is not a URL instead of silently allowing nothing", () => {
      process.env.AOP_ALLOWED_ORIGINS = "mac.tail1234.ts.net";

      expect(() => getAllowedOrigins()).toThrow(
        "AOP_ALLOWED_ORIGINS entry is not a URL: mac.tail1234.ts.net",
      );
    });
  });
});

const restore = (key: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
