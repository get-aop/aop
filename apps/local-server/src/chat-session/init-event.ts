// The init event opens a run's log. A long tool and MCP list makes it big, never this big.
const HEAD_BYTES = 256 * 1024;

/**
 * The `system` init event a Claude Code `stream-json` run writes first: it names the model, and
 * the CLI version the run started on. Null when the log is missing or has none.
 */
export const readRunInitEvent = async (
  logPath: string,
): Promise<Record<string, unknown> | null> => {
  const head = await Bun.file(logPath)
    .slice(0, HEAD_BYTES)
    .text()
    .catch(() => "");
  for (const line of head.split("\n")) {
    const event = parseLine(line);
    if (event?.type === "system" && event.subtype === "init") return event;
  }
  return null;
};

/** The CLI version a run's init event names under `field`, or null. */
export const readRunCliVersion = async (logPath: string, field: string): Promise<string | null> => {
  const version = (await readRunInitEvent(logPath))?.[field];
  return typeof version === "string" && version.trim() !== "" ? version.trim() : null;
};

const parseLine = (line: string): Record<string, unknown> | null => {
  if (!line.trim().startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
