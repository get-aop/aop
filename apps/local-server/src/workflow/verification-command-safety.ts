const MAX_VERIFY_COMMANDS = 5;
const MAX_VERIFY_COMMAND_LENGTH = 200;
const SHELL_CONTROL_PATTERN = /[;&|<>`$]/;

export const assertSafeVerifyCommands = (commands: string[] | undefined): string[] | undefined => {
  if (!commands) return undefined;
  if (commands.length > MAX_VERIFY_COMMANDS) {
    throw new Error(`Verification commands are limited to ${MAX_VERIFY_COMMANDS} commands`);
  }

  const normalized = commands.map((command) => command.trim());
  for (const command of normalized) {
    if (!command) {
      throw new Error("Verification commands cannot be empty");
    }
    if (command.length > MAX_VERIFY_COMMAND_LENGTH) {
      throw new Error(
        `Verification commands cannot exceed ${MAX_VERIFY_COMMAND_LENGTH} characters`,
      );
    }
    if (SHELL_CONTROL_PATTERN.test(command)) {
      throw new Error("Verification commands cannot contain shell control characters");
    }
  }

  return normalized;
};
