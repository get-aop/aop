import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  MAX_CONCURRENT_RUNS_LIMIT,
  parseMaxConcurrentRuns,
} from "./run-cap.ts";

describe("parseMaxConcurrentRuns", () => {
  test("reads a whole number from 1 to the limit", () => {
    expect(parseMaxConcurrentRuns("1")).toBe(1);
    expect(parseMaxConcurrentRuns("4")).toBe(4);
    expect(parseMaxConcurrentRuns("32")).toBe(32);
    expect(parseMaxConcurrentRuns(String(MAX_CONCURRENT_RUNS_LIMIT))).toBe(
      MAX_CONCURRENT_RUNS_LIMIT,
    );
  });

  test.each([
    "",
    "0",
    "33",
    "100",
    "999",
    "1000",
    "-1",
    "4.5",
    "04",
    " 4",
    "4 ",
    "1e1",
    "0x10",
    "abc",
  ])("refuses %p", (value) => {
    expect(parseMaxConcurrentRuns(value)).toBeNull();
  });

  test("the default is a valid cap", () => {
    expect(parseMaxConcurrentRuns(String(DEFAULT_MAX_CONCURRENT_RUNS))).toBe(
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
  });
});
