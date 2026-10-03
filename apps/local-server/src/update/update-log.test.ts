import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServiceHarness, scratchDir } from "./test-utils.ts";
import { readUpdateLog, UPDATE_LOG_LINES } from "./update-log.ts";
import { createUpdateService } from "./update-service.ts";

describe("the update log", () => {
  test("is empty before any update ran", async () => {
    const path = join(await scratchDir("log"), "update.log");

    expect(await readUpdateLog(path)).toEqual({ path, lines: [] });
  });

  test("gives the last lines of the updater's log", async () => {
    const path = join(await scratchDir("log"), "update.log");
    const lines = Array.from({ length: 250 }, (_, index) => `line ${index + 1}`);
    await writeFile(path, `${lines.join("\n")}\n`);

    const log = await readUpdateLog(path);

    expect(log.lines).toHaveLength(UPDATE_LOG_LINES);
    expect(log.lines[0]).toBe("line 51");
    expect(log.lines.at(-1)).toBe("line 250");
  });

  test("reads only the end of a large log, never half a line", async () => {
    const path = join(await scratchDir("log"), "update.log");
    const long = "x".repeat(1_000);
    const lines = Array.from({ length: 300 }, (_, index) => `${index} ${long}`);
    await writeFile(path, lines.join("\n"));

    const log = await readUpdateLog(path);

    expect(log.lines.length).toBeGreaterThan(0);
    expect(log.lines.every((line) => /^\d+ x+$/.test(line) && line.endsWith(long))).toBe(true);
    expect(log.lines.at(-1)).toBe(`299 ${long}`);
  });

  test("the service reads the host's own log file", async () => {
    const stops: Array<() => void> = [];
    const h = await createServiceHarness({}, stops);
    try {
      await Bun.write(h.deps.logFile ?? "", "Downloading AOP 0.10.0\nUpdate failed: boom\n");

      expect(await createUpdateService(h.deps).log()).toEqual({
        path: h.deps.logFile ?? "",
        lines: ["Downloading AOP 0.10.0", "Update failed: boom"],
      });
    } finally {
      for (const stop of stops) stop();
    }
  });
});
