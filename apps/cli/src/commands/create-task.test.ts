import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createTaskCommand } from "./create-task.ts";

const mockExit = mock((code?: number) => {
  throw new Error(`process.exit:${code ?? 0}`);
});
const logger = {
  debug: mock(async () => undefined),
  error: mock(async () => undefined),
  info: mock(async () => undefined),
  warn: mock(async () => undefined),
};

beforeEach(() => {
  mockExit.mockReset();
  logger.error.mockReset();
  mockExit.mockImplementation((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  });
});

describe("createTaskCommand", () => {
  test("exits with deprecation message", async () => {
    await expect(
      createTaskCommand(
        "Build release flow",
        {},
        { exit: mockExit as typeof process.exit, logger },
      ),
    ).rejects.toThrow("process.exit:1");

    expect(logger.error).toHaveBeenCalledWith(
      "create-task is deprecated. Open AOP Sessions and use /task create so the session can generate the complete task package.",
    );
  });
});
