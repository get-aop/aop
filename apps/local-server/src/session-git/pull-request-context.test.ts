import { describe, expect, mock, test } from "bun:test";
import type { CommandResult } from "../command-runner.ts";
import { checkGhAvailable } from "./pull-request-context.ts";

describe("checkGhAvailable", () => {
  test("shares an in-flight authentication check across workspaces", async () => {
    const result = Promise.withResolvers<CommandResult>();
    const runGh = mock(async () => result.promise);

    const first = checkGhAvailable(runGh, "/repo");
    const second = checkGhAvailable(runGh, "/other-repo");

    expect(runGh).toHaveBeenCalledTimes(1);
    result.resolve({ exitCode: 0, stdout: "", stderr: "" });
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
  });
});
