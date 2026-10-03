import { describe, expect, test } from "bun:test";
import { answerMetaCommand, FAKE_CLI_VERSION_LINE } from "./meta";

const answer = (args: string[], env: Record<string, string | undefined> = {}) => {
  let output = "";
  const exitCode = answerMetaCommand(args, env, (text) => {
    output += text;
  });
  return { exitCode, output };
};

describe("answerMetaCommand", () => {
  test("prints a Claude Code style version", () => {
    expect(answer(["--version"])).toEqual({ exitCode: 0, output: `${FAKE_CLI_VERSION_LINE}\n` });
  });

  test("reports logged in, or logged out when told to", () => {
    expect(JSON.parse(answer(["auth", "status"]).output).loggedIn).toBe(true);
    const out = answer(["auth", "status"], { FAKE_CLI_LOGGED_OUT: "1" });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.output).loggedIn).toBe(false);
  });

  test("leaves a turn's arguments alone", () => {
    expect(answer(["-p", "--output-format", "stream-json"]).exitCode).toBeNull();
  });
});
