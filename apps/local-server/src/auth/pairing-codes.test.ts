import { describe, expect, test } from "bun:test";
import { createPairingCodes } from "./pairing-codes.ts";

const T0 = new Date("2026-09-30T09:00:00.000Z");

const setup = (ttlMs?: number) => {
  let clock = T0;
  const codes = createPairingCodes({ ttlMs, now: () => clock });
  return {
    codes,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
};

describe("pairing codes", () => {
  test("issues an easy-to-read code that expires ten minutes later by default", () => {
    const { codes } = setup();

    const grant = codes.issue();

    expect(grant.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(grant.expiresAt.toISOString()).toBe("2026-09-30T09:10:00.000Z");
  });

  test("a code works once", () => {
    const { codes } = setup();
    const { code } = codes.issue();

    expect(codes.consume(code)).toBe(true);
    expect(codes.consume(code)).toBe(false);
  });

  test("accepts the code however it was typed", () => {
    const { codes } = setup();
    const { code } = codes.issue();

    expect(codes.consume(` ${code.toLowerCase().replace("-", " ")} `)).toBe(true);
  });

  test("refuses a wrong code and keeps the right one open", () => {
    const { codes } = setup();
    const { code } = codes.issue();

    expect(codes.consume("AAAA-AAAA")).toBe(false);
    expect(codes.consume("")).toBe(false);
    expect(codes.consume(code)).toBe(true);
  });

  test("a code stops working when it expires", () => {
    const { codes, advance } = setup(60_000);
    const { code } = codes.issue();

    advance(60_000);

    expect(codes.consume(code)).toBe(false);
  });

  test("issuing a new code closes the previous one", () => {
    const { codes } = setup();
    const first = codes.issue();
    const second = codes.issue();

    expect(codes.consume(first.code)).toBe(false);
    expect(codes.consume(second.code)).toBe(true);
  });

  test("nothing pairs before a code is issued", () => {
    expect(setup().codes.consume("ABCD-2345")).toBe(false);
  });
});
