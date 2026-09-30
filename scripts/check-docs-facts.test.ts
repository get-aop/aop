import { describe, expect, test } from "bun:test";
import { checkFacts, checkForbiddenPatterns, runDocsCheck } from "./check-docs-facts.ts";

describe("checkForbiddenPatterns", () => {
  test("flags internal ticket ids with line numbers", () => {
    const content = "intro\nSee GET-58 for details\nand GET-7 too\n";
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

  test("flags runtimes that are not registered but not words that merely contain omp", () => {
    expect(checkForbiddenPatterns("d.md", "use `cursor-cli` or omp")).toHaveLength(2);
    expect(checkForbiddenPatterns("d.md", "compile the prompt")).toHaveLength(0);
  });
});

describe("checkFacts", () => {
  const documented = () =>
    new Map([
      ["README.md", "Dashboard at http://aop.localhost:25150"],
      ["apps/cli/README.md", "The server listens on port 25150."],
      ["docs/RUNTIMES.md", "`claude-code`, `codex-cli`, and `pi`"],
    ]);

  test("passes when every fact is documented", () => {
    expect(checkFacts(documented())).toEqual([]);
  });

  test("names the runtime missing from the runtimes guide", () => {
    const docs = documented();
    docs.set("docs/RUNTIMES.md", "`claude-code` and `codex-cli`");
    const violations = checkFacts(docs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("docs/RUNTIMES.md");
    expect(violations[0]?.message).toContain("`pi`");
  });

  test("reports every fact when the documents are absent", () => {
    const files = checkFacts(new Map()).map((violation) => violation.file);
    expect(files.sort()).toEqual([
      "README.md",
      "apps/cli/README.md",
      "docs/RUNTIMES.md",
      "docs/RUNTIMES.md",
      "docs/RUNTIMES.md",
    ]);
  });
});

describe("runDocsCheck", () => {
  test("the published docs in this repo pass", async () => {
    const violations = await runDocsCheck();
    expect(violations).toEqual([]);
  });
});
