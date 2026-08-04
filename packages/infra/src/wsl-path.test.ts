import { describe, expect, test } from "bun:test";
import { isWindowsPath, windowsToWsl, wslToWindows } from "./wsl-path.ts";

describe("wsl-path", () => {
  describe("windowsToWsl", () => {
    test("maps a drive-letter path to /mnt/<drive>", () => {
      expect(windowsToWsl("C:\\Users\\me\\repo")).toBe("/mnt/c/Users/me/repo");
    });

    test("maps a bare drive root", () => {
      expect(windowsToWsl("C:\\")).toBe("/mnt/c");
    });

    test("maps a \\\\wsl$ UNC path to a distro-internal path", () => {
      expect(windowsToWsl("\\\\wsl$\\Ubuntu\\home\\me")).toBe("/home/me");
    });

    test("maps the \\\\wsl.localhost UNC form too", () => {
      expect(windowsToWsl("\\\\wsl.localhost\\Ubuntu\\home\\me")).toBe("/home/me");
    });

    test("is idempotent on an already-WSL path", () => {
      expect(windowsToWsl("/mnt/c/Users/me/repo")).toBe("/mnt/c/Users/me/repo");
    });
  });

  describe("wslToWindows", () => {
    test("maps /mnt/<drive> back to a drive-letter path", () => {
      expect(wslToWindows("/mnt/c/Users/me/repo")).toBe("C:\\Users\\me\\repo");
    });

    test("maps a distro-internal path to a \\\\wsl$ UNC path with the distro", () => {
      expect(wslToWindows("/home/me", "Ubuntu")).toBe("\\\\wsl$\\Ubuntu\\home\\me");
    });

    test("returns a distro-internal path unchanged without a distro", () => {
      expect(wslToWindows("/home/me")).toBe("/home/me");
    });

    test("is idempotent on an already-Windows path", () => {
      expect(wslToWindows("C:\\Users\\me\\repo")).toBe("C:\\Users\\me\\repo");
    });
  });

  describe("round-trips", () => {
    test("drive-letter path round-trips", () => {
      const win = "C:\\Users\\me\\repo";
      expect(wslToWindows(windowsToWsl(win))).toBe(win);
    });

    test("distro-internal path round-trips with the distro", () => {
      const win = "\\\\wsl$\\Ubuntu\\home\\me";
      expect(wslToWindows(windowsToWsl(win), "Ubuntu")).toBe(win);
    });
  });

  describe("isWindowsPath", () => {
    test("recognizes drive-letter and UNC paths, rejects posix paths", () => {
      expect(isWindowsPath("C:\\x")).toBe(true);
      expect(isWindowsPath("\\\\wsl$\\Ubuntu\\home")).toBe(true);
      expect(isWindowsPath("/mnt/c/x")).toBe(false);
    });
  });
});
