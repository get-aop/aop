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

  test("the Library's defaults are whole numbers, 0 meaning keep or no cap", () => {
    expect(settingError("library_retention_days", "0")).toBeNull();
    expect(settingError("library_retention_days", "30")).toBeNull();
    expect(settingError("library_retention_days", "3651")).toBe(
      "Enter a whole number of days from 0 to 3650.",
    );
    expect(settingError("library_project_cap_mb", "1024")).toBeNull();
    expect(settingError("library_host_cap_mb", "-5")).toBe(
      "Enter a whole number of MB from 0 to 1048576.",
    );
  });
});
