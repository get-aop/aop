import { describe, expect, test } from "bun:test";
import { settingError } from "./setting-validation";

describe("settingError", () => {
  test.each(["1", "4", "32"])("accepts a run cap of %p", (value) => {
    expect(settingError("max_concurrent_runs", value)).toBeNull();
  });

  test.each(["", "0", "33", "4.5", "-1", "abc", " 4", "04"])(
    "refuses a run cap of %p and names the range",
    (value) => {
      expect(settingError("max_concurrent_runs", value)).toBe("Enter a whole number from 1 to 32.");
    },
  );

  test("free-text settings take any value, including none", () => {
    expect(settingError("chat_global_instructions", "")).toBeNull();
    expect(settingError("chat_global_instructions", "Be brief.")).toBeNull();
  });
});
