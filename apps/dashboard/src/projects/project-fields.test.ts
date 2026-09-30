import { describe, expect, test } from "bun:test";
import { projectNameProblem } from "./project-fields";

describe("projectNameProblem", () => {
  test("names the field and the limit for a name that is too long", () => {
    expect(projectNameProblem("x".repeat(101))).toBe("Name can be at most 100 characters.");
  });

  test("has no problem with a name at the limit, and none with a name not typed yet", () => {
    expect(projectNameProblem("x".repeat(100))).toBeNull();
    expect(projectNameProblem("")).toBeNull();
    expect(projectNameProblem("   ")).toBeNull();
  });

  test("counts the name as the host will save it, without the spaces around it", () => {
    expect(projectNameProblem(`  ${"x".repeat(100)}  `)).toBeNull();
  });
});
