import { execFile } from "node:child_process";
import { resolve } from "node:path";

/** What `codesign -dv` prints about a bundle; it writes the details to stderr. */
export type DescribeSignature = (bundlePath: string) => Promise<string>;

/** The `.app` bundle of an executable at `AOP.app/Contents/MacOS/AOP`. */
export const appBundleOf = (executablePath: string): string => resolve(executablePath, "../../..");

/**
 * Whether the bundle carries a Developer ID signature. Squirrel.Mac installs an update only over
 * such an app (and only an update signed by the same team), so this decides whether the macOS
 * app updates itself. An ad-hoc signature, what a build without the Apple certificate gets, says
 * `Signature=adhoc` and names no authority; an unsigned bundle makes codesign fail.
 */
export const isDeveloperIdSigned = async (
  bundlePath: string,
  describe: DescribeSignature = describeWithCodesign,
): Promise<boolean> => {
  try {
    return /^Authority=Developer ID Application: /m.test(await describe(bundlePath));
  } catch {
    return false;
  }
};

const describeWithCodesign: DescribeSignature = (bundlePath) =>
  new Promise((done, fail) => {
    execFile(
      "codesign",
      ["-dv", "--verbose=2", bundlePath],
      { timeout: 10_000 },
      (error, _stdout, stderr) => (error ? fail(error) : done(String(stderr))),
    );
  });
