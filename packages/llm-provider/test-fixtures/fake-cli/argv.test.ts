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

  test("lists every flag in order, known or not, and never a value or the prompt", () => {
    const parsed = parseArgv(
      ["--verbose", "--model", "m1", "--add-dir", "/a", "the prompt", "--resume", "s1"],
      spec,
    );

    expect(parsed.flags).toEqual(["--verbose", "--model", "--add-dir", "--resume"]);
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

  test("records what a variadic flag consumed, accumulating across repeats", () => {
    const parsed = parseArgv(
      ["--add-dir", "/a", "/b", "--model", "m1", "--add-dir", "/c", "--model", "m2", "the prompt"],
      spec,
    );

    expect(parsed.variadicValues.get("--add-dir")).toEqual(["/a", "/b", "/c"]);
    expect(parsed.positionals).toEqual(["the prompt"]);
  });

  test("an empty-string argument is a value, not the end of a variadic flag", () => {
    const parsed = parseArgv(["the prompt", "--add-dir", ""], spec);

    expect(parsed.variadicValues.get("--add-dir")).toEqual([""]);
    expect(parsed.positionals).toEqual(["the prompt"]);
  });

  test("tolerates a value flag at the end of argv", () => {
    expect(parseArgv(["--model"], spec).values.get("--model")).toBe("");
  });
});
