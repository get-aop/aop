import { describe, expect, test } from "bun:test";
import { guiSafePathFor, platformDetails } from "./platform";

describe("Electron host platform support", () => {
  test("builds the existing GUI-safe macOS path", () => {
    expect(
      guiSafePathFor("unix", {
        home: "/home/u",
        path: "/usr/bin:/bin",
      }),
    ).toBe(
      "/home/u/.local/bin:/home/u/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });

  test("seeds Windows package-manager and user binary paths", () => {
    const path = guiSafePathFor("windows", {
      home: "C:\\Users\\m",
      localAppData: "C:\\Users\\m\\AppData\\Local",
      path: "C:\\Windows;C:\\Windows\\System32",
      userProfile: "C:\\Users\\m",
    });

    expect(path).toContain("C:\\Users\\m\\AppData\\Local\\Microsoft\\WinGet\\Links");
    expect(path).toContain("C:\\Users\\m\\.bun\\bin");
    expect(path).toContain("C:\\Program Files\\Git\\cmd");
    expect(path).toContain("C:\\Program Files\\GitHub CLI");
    expect(path).toEndWith("C:\\Windows;C:\\Windows\\System32");
    expect(path).not.toContain("/opt/homebrew");
  });

  test("provides platform separators and sidecar names", () => {
    expect(platformDetails("unix")).toEqual({
      executableSuffix: "",
      pathSeparator: ":",
      sidecarResourceName: "aop",
    });
    expect(platformDetails("windows")).toEqual({
      executableSuffix: ".exe",
      pathSeparator: ";",
      sidecarResourceName: "aop.exe",
    });
  });
});
