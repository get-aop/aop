import { describe, expect, test } from "bun:test";
import { appBundleOf, isDeveloperIdSigned } from "./mac-signature";

// What `codesign -dv --verbose=2` prints for the two kinds of app.
const ADHOC = [
  "Executable=/Applications/AOP.app/Contents/MacOS/AOP",
  "Identifier=com.getaop.aop",
  "CodeDirectory v=20400 size=423 flags=0x2(adhoc) hashes=3+7 location=embedded",
  "Signature=adhoc",
  "TeamIdentifier=not set",
].join("\n");
const DEVELOPER_ID = [
  "Executable=/Applications/AOP.app/Contents/MacOS/AOP",
  "Identifier=com.getaop.aop",
  "Signature size=9045",
  "Authority=Developer ID Application: Example Inc (TEAM12345)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "TeamIdentifier=TEAM12345",
].join("\n");

describe("isDeveloperIdSigned", () => {
  test("is true for a bundle a Developer ID signed", async () => {
    expect(await isDeveloperIdSigned("/Applications/AOP.app", async () => DEVELOPER_ID)).toBe(true);
  });

  test("is false for the ad-hoc signature an unsigned release build carries", async () => {
    expect(await isDeveloperIdSigned("/Applications/AOP.app", async () => ADHOC)).toBe(false);
  });

  test("is false when codesign fails, as it does for an unsigned bundle", async () => {
    const failing = async (): Promise<string> => {
      throw new Error("code object is not signed at all");
    };
    expect(await isDeveloperIdSigned("/Applications/AOP.app", failing)).toBe(false);
  });

  test("asks about the bundle the running executable belongs to", async () => {
    const asked: string[] = [];
    await isDeveloperIdSigned(
      appBundleOf("/Applications/AOP.app/Contents/MacOS/AOP"),
      async (p) => {
        asked.push(p);
        return ADHOC;
      },
    );
    expect(asked).toEqual(["/Applications/AOP.app"]);
  });
});
