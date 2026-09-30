import { describe, expect, test } from "bun:test";
import { chooseUpdateMode, MAC_AUTO_UPDATE_ENABLED } from "./update-policy";

const input = { packaged: true, disabled: false } as const;

describe("chooseUpdateMode", () => {
  test("the switch is off until the macOS app is signed", () => {
    expect(MAC_AUTO_UPDATE_ENABLED).toBe(false);
  });

  test("Windows updates itself once packaged, and does nothing in development", () => {
    expect(chooseUpdateMode({ ...input, platform: "win32" })).toBe("auto");
    expect(chooseUpdateMode({ ...input, platform: "win32", packaged: false })).toBe("off");
  });

  test("macOS shows a notice while the switch is off, even unpackaged", () => {
    expect(chooseUpdateMode({ ...input, platform: "darwin", macAutoUpdate: false })).toBe("notice");
    expect(
      chooseUpdateMode({ ...input, platform: "darwin", packaged: false, macAutoUpdate: false }),
    ).toBe("notice");
  });

  test("macOS takes the Windows path once the switch is on", () => {
    expect(chooseUpdateMode({ ...input, platform: "darwin", macAutoUpdate: true })).toBe("auto");
    expect(
      chooseUpdateMode({ ...input, platform: "darwin", packaged: false, macAutoUpdate: true }),
    ).toBe("off");
  });

  test("the opt-out wins everywhere, and other platforms have no app", () => {
    expect(chooseUpdateMode({ ...input, platform: "win32", disabled: true })).toBe("off");
    expect(chooseUpdateMode({ ...input, platform: "darwin", disabled: true })).toBe("off");
    expect(chooseUpdateMode({ ...input, platform: "linux" })).toBe("off");
  });
});
