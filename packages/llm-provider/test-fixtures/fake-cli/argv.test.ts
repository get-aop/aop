import { describe, expect, test } from "bun:test";
import { parseArgv } from "./argv";

const spec = { valueFlags: ["--model", "--resume"], variadicFlags: ["--add-dir"] };

describe("parseArgv", () => {
  test("separates flag values from positionals", () => {
    const parsed = parseArgv(["--verbose", "--model", "m1", "the prompt", "--resume", "s1"], spec);

    expect(parsed.values.get("--model")).toBe("m1");
    expect(parsed.values.get("--resume")).toBe("s1");
    expect(parsed.positionals).toEqual(["the prompt"]);
  });

  test("ignores flags it does not know without consuming the next argument", () => {
    const parsed = parseArgv(["--dangerously-skip-permissions", "the prompt"], spec);

    expect(parsed.positionals).toEqual(["the prompt"]);
  });

  test("a variadic flag consumes up to the next flag, prompt included", () => {
    const swallowed = parseArgv(["--add-dir", "/a", "/b", "the prompt"], spec);
    const bounded = parseArgv(["--add-dir", "/a", "--model", "m1", "the prompt"], spec);

    expect(swallowed.positionals).toEqual([]);
    expect(bounded.positionals).toEqual(["the prompt"]);
  });

  test("tolerates a value flag at the end of argv", () => {
    expect(parseArgv(["--model"], spec).values.get("--model")).toBe("");
  });
});
