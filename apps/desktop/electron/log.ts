// biome-ignore-all lint/suspicious/noConsole: the app's main process has no logger; this is its one place to write a line.
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type Logger = (message: string, fields?: Record<string, unknown>) => void;

/**
 * One line per event, to the desktop log beside the host server's own logs (the "Open logs"
 * button opens the folder) and, when asked, to the terminal the app was started from.
 * Tokens never reach it: no caller has one to give.
 */
export const createLogger = (logFile: string, alsoToConsole: boolean): Logger => {
  let ready: Promise<unknown> | null = null;
  return (message, fields) => {
    const line = `${new Date().toISOString()} ${message}${fields ? ` ${JSON.stringify(fields)}` : ""}`;
    if (alsoToConsole) console.info(`[aop-desktop] ${line}`);
    ready ??= mkdir(dirname(logFile), { recursive: true });
    // A log that cannot be written must not take the app down with it.
    void ready.then(() => appendFile(logFile, `${line}\n`)).catch(() => undefined);
  };
};
