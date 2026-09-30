import { describe, expect, test } from "bun:test";
import {
  attemptsOf,
  claim,
  confirm,
  handledKeys,
  hasKind,
  newFix,
  newReport,
  reconcile,
  release,
  type WatchEntry,
} from "./ledger.ts";

const AT = new Date("2026-09-30T12:00:00.000Z");
const fix = (keys: string[]): WatchEntry => newFix(keys, `fix ${keys.join(",")}`, AT);

describe("what the ledger remembers", () => {
  test("attempts are the fixes sent, and reports are not attempts", () => {
    const entries = [fix(["a"]), fix(["b"]), newReport("cap", "gave up", AT)];

    expect(attemptsOf(entries)).toBe(2);
    expect(hasKind(entries, "cap")).toBe(true);
    expect(hasKind(entries, "merged")).toBe(false);
  });

  test("the occurrences answered are the keys of the fixes, not of reports", () => {
    const entries = [fix(["a", "b"]), fix(["c"]), newReport("closed", "closed", AT)];

    expect([...handledKeys(entries)].sort()).toEqual(["a", "b", "c"]);
  });

  test("a fix starts unconfirmed and a report is delivered as soon as it is written", () => {
    expect(fix(["a"]).delivered).toBe(false);
    expect(newReport("merged", "merged", AT).delivered).toBe(true);
    expect(fix(["a"]).id).not.toBe(fix(["a"]).id);
  });
});

describe("claiming a fix", () => {
  test("adds it as an attempt", () => {
    const first = fix(["a"]);

    expect(claim([], first, 3)).toEqual([first]);
  });

  test("is refused at the cap, and for an occurrence that was already answered", () => {
    const full = [fix(["a"]), fix(["b"])];

    expect(claim(full, fix(["c"]), 2)).toBeNull();
    expect(claim([fix(["a"])], fix(["a", "z"]), 3)).toBeNull();
    expect(claim([fix(["a"])], fix(["z"]), 3)).toHaveLength(2);
  });
});

describe("confirming, releasing and reconciling", () => {
  test("confirming marks only that fix delivered, and releasing takes it back out", () => {
    const first = fix(["a"]);
    const second = fix(["b"]);

    const confirmed = confirm([first, second], first.id);

    expect(confirmed.map((entry) => entry.delivered)).toEqual([true, false]);
    expect(release(confirmed, second.id)).toEqual([confirmed[0] as WatchEntry]);
    // The occurrence is free again, so a later poll can send it.
    expect(handledKeys(release(confirmed, second.id))).toEqual(new Set(["a"]));
  });

  test("a crash between writing a fix down and sending it is settled by whether the thread has the message", () => {
    const sent = fix(["a"]);
    const lost = fix(["b"]);
    const done = { ...fix(["c"]), delivered: true };

    const settled = reconcile([sent, lost, done], (id) => id === sent.id);

    expect(settled.map((entry) => [entry.keys[0], entry.delivered])).toEqual([
      ["a", true],
      ["c", true],
    ]);
  });

  test("leaves what is already delivered as it is, even when its message cannot be found", () => {
    const delivered = { ...fix(["a"]), delivered: true };

    expect(reconcile([delivered], () => false)).toEqual([delivered]);
  });
});
