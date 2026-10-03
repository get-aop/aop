import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Runs the Android app's Gradle tasks for the repository's scripts. `bun run typecheck` and
 * `bun check` reach the app through here, so a machine without a JDK and an Android SDK skips
 * it with a note instead of failing; CI has both and never skips.
 */
const TASKS: Record<string, string[]> = {
  typecheck: [":shared:compileAndroidMain", ":androidApp:compileDebugKotlin"],
  lint: [":androidApp:lintDebug"],
  test: [":shared:testAndroidHostTest", ":androidApp:testDebugUnitTest"],
  apk: [":androidApp:assembleRelease"],
};

const appDir = join(import.meta.dir, "..");

const firstExisting = (candidates: (string | undefined)[]): string | undefined =>
  candidates.find((candidate) => candidate !== undefined && existsSync(candidate));

const javaHome = firstExisting([
  process.env.JAVA_HOME,
  process.env.JAVA_HOME_17_X64,
  join(homedir(), ".local/share/jdk/jdk-17"),
]);
const androidHome = firstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(homedir(), ".local/share/android-sdk"),
  join(homedir(), "Android/Sdk"),
  join(homedir(), "Library/Android/sdk"),
]);

const command = process.argv[2] ?? "";
const tasks = TASKS[command];
if (!tasks) {
  process.stderr.write(
    `${`Unknown command "${command}". Use one of: ${Object.keys(TASKS).join(", ")}`}\n`,
  );
  process.exit(2);
}

if (!javaHome || !androidHome) {
  const missing = [
    !javaHome && "a JDK 17 (JAVA_HOME)",
    !androidHome && "the Android SDK (ANDROID_HOME)",
  ]
    .filter(Boolean)
    .join(" and ");
  if (process.env.CI) {
    process.stderr.write(`@aop/mobile ${command}: needs ${missing}.\n`);
    process.exit(1);
  }
  process.stdout.write(
    `${`@aop/mobile ${command}: skipped, ${missing} not found (see apps/mobile/README.md).`}\n`,
  );
  process.exit(0);
}

const gradle = Bun.spawn(["./gradlew", "--console=plain", ...tasks, ...process.argv.slice(3)], {
  cwd: appDir,
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    PATH: `${join(javaHome, "bin")}:${process.env.PATH ?? ""}`,
  },
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await gradle.exited);
