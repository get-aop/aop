import { describe, expect, test } from "bun:test";
import { checkForbiddenPatterns, runDocsCheck } from "./check-docs-facts.ts";

describe("checkForbiddenPatterns", () => {
  test("flags internal ticket ids and phantom settings with line numbers", () => {
    const content = "intro\nSee GET-58 for details\nset `default_workflow` to taste\n";
    const violations = checkForbiddenPatterns("docs/x.md", content);
    expect(violations).toHaveLength(2);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.message).toContain("Linear ticket");
    expect(violations[1]?.line).toBe(3);
  });

  test("allows legacy port/env mentions on lines marked obsolete", () => {
    const allowed = "Legacy `AOP_URL` / port `3847` are obsolete.\n";
    expect(checkForbiddenPatterns("docs/x.md", allowed)).toHaveLength(0);
    const notAllowed = "Connect to port 3847.\n";
    expect(checkForbiddenPatterns("docs/x.md", notAllowed)).toHaveLength(1);
  });

  test("flags bare aop-default but not the canonical default names", () => {
    expect(
      checkForbiddenPatterns("d.md", "use `aop-default-gpt` or `aop-default-claude`"),
    ).toHaveLength(0);
    expect(checkForbiddenPatterns("d.md", "use `aop-default`")).toHaveLength(1);
  });
});

describe("runDocsCheck", () => {
  test("the published docs in this repo pass", async () => {
    const violations = await runDocsCheck();
    expect(violations).toEqual([]);
  });
});
