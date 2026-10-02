import { describe, expect, test } from "bun:test";
import { chooseUpdateMode } from "./update-policy";

const input = { packaged: true, disabled: false, macSigned: false } as const;

describe("chooseUpdateMode", () => {
  test("Windows updates itself once packaged, and does nothing in development", () => {
    expect(chooseUpdateMode({ ...input, platform: "win32" })).toBe("auto");
    expect(chooseUpdateMode({ ...input, platform: "win32", packaged: false })).toBe("off");
  });

  test("a macOS app without a Developer ID signature shows a notice, even unpackaged", () => {
    expect(chooseUpdateMode({ ...input, platform: "darwin" })).toBe("notice");
    expect(chooseUpdateMode({ ...input, platform: "darwin", packaged: false })).toBe("notice");
  });

  test("a Developer ID signed macOS app takes the Windows path", () => {
    expect(chooseUpdateMode({ ...input, platform: "darwin", macSigned: true })).toBe("auto");
    expect(
      chooseUpdateMode({ ...input, platform: "darwin", packaged: false, macSigned: true }),
    ).toBe("off");
  });

  test("the opt-out wins everywhere, and other platforms have no app", () => {
    expect(chooseUpdateMode({ ...input, platform: "win32", disabled: true })).toBe("off");
    expect(
      chooseUpdateMode({ ...input, platform: "darwin", disabled: true, macSigned: true }),
    ).toBe("off");
    expect(chooseUpdateMode({ ...input, platform: "linux" })).toBe("off");
  });
});
