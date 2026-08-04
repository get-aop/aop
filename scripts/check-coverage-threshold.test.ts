import { describe, expect, test } from "bun:test";
import { checkCoverageThresholds, parseLcovSummary } from "./check-coverage-threshold.ts";

describe("check-coverage-threshold", () => {
  test("parses aggregate line and function coverage from lcov", () => {
    const summary = parseLcovSummary(
      `TN:\nSF:src/a.ts\nFNF:2\nFNH:1\nLF:10\nLH:9\nend_of_record\nSF:src/b.ts\nFNF:3\nFNH:3\nLF:30\nLH:27\nend_of_record\n`,
    );

    expect(summary).toEqual({ functions: 0.8, lines: 0.9 });
  });

  test("reports coverage below configured global thresholds", () => {
    const failures = checkCoverageThresholds(
      { functions: 0.5, lines: 0.69 },
      { functions: 0, lines: 0.7 },
    );

    expect(failures).toEqual(["Line coverage 69.00% is below threshold 70.00%"]);
  });
});
