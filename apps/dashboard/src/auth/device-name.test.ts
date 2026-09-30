import { describe, expect, test } from "bun:test";
import { defaultDeviceName } from "./device-name";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ELECTRON_MAC = `${CHROME_MAC} Electron/43.0.0`;

describe("defaultDeviceName", () => {
  test("names the browser and the system, so the owner can tell devices apart", () => {
    expect(defaultDeviceName(CHROME_MAC)).toBe("Chrome on macOS");
    expect(defaultDeviceName(EDGE_WINDOWS)).toBe("Edge on Windows");
    expect(defaultDeviceName(SAFARI_IOS)).toBe("Safari on iOS");
    expect(
      defaultDeviceName("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"),
    ).toBe("Firefox on Linux");
  });

  test("the desktop app says so", () => {
    expect(defaultDeviceName(ELECTRON_MAC)).toBe("AOP Desktop on macOS");
  });

  test("an unknown agent still gets a usable name", () => {
    expect(defaultDeviceName("curl/8")).toBe("Browser on an unknown system");
  });
});
