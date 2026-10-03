import { describe, expect, test } from "bun:test";
import { pairingLink } from "./pairing-link";

describe("pairingLink", () => {
  test("carries the code, and the address when the page is served over HTTPS", () => {
    expect(pairingLink("ABCD-EFGH", "https://soulf.tail1.ts.net:25650")).toBe(
      "aop://pair?code=ABCD-EFGH&host=https%3A%2F%2Fsoulf.tail1.ts.net%3A25650",
    );
  });

  test("leaves out a loopback or plain-HTTP address, which a phone cannot use", () => {
    expect(pairingLink("ABCD-EFGH", "http://127.0.0.1:25650")).toBe("aop://pair?code=ABCD-EFGH");
    expect(pairingLink("ABCD-EFGH", null)).toBe("aop://pair?code=ABCD-EFGH");
  });
});
