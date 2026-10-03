/** What `--version` prints: Claude Code's shape, so a version reader finds `0.0.0`. */
export const FAKE_CLI_VERSION_LINE = "0.0.0-fake (Claude Code)";

/**
 * The calls AOP makes to look at a runtime rather than run a turn: `--version` and `auth status`
 * (runtime-configuration/readiness.ts). `auth status` answers like Claude Code's JSON; set
 * `FAKE_CLI_LOGGED_OUT=1` to make it report a runtime that is not logged in. Returns the exit
 * code when the arguments were one of them, or null for a turn.
 */
export const answerMetaCommand = (
  args: readonly string[],
  env: Record<string, string | undefined>,
  write: (text: string) => void,
): number | null => {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    write(`${FAKE_CLI_VERSION_LINE}\n`);
    return 0;
  }
  if (args[0] === "auth" && args[1] === "status") {
    const loggedIn = env.FAKE_CLI_LOGGED_OUT !== "1";
    write(`${JSON.stringify({ loggedIn, authMethod: loggedIn ? "fake" : "none" }, null, 2)}\n`);
    return loggedIn ? 0 : 1;
  }
  return null;
};
