import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { describeFirstIssue, describeIssue, describeIssuesByField } from "./issues.ts";
import { CreateProjectInputSchema } from "./projects/project.ts";

const issuesOf = (schema: z.ZodType, input: unknown) => {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error("expected the input to be refused");
  return parsed.error.issues;
};

const first = (schema: z.ZodType, input: unknown, labels = {}) => {
  const [issue] = issuesOf(schema, input);
  if (!issue) throw new Error("no issue");
  return describeIssue(issue, labels);
};

describe("describeIssue", () => {
  test("names a too-long text and its limit", () => {
    expect(first(CreateProjectInputSchema, { name: "x".repeat(101) })).toBe(
      "Name can be at most 100 characters.",
    );
  });

  test("says a blank required text is required, and a longer minimum in characters", () => {
    expect(first(CreateProjectInputSchema, { name: "   " })).toBe("Name is required.");
    expect(first(z.object({ token: z.string().min(8) }), { token: "abc" })).toBe(
      "Token needs at least 8 characters.",
    );
  });

  test("says a missing field is required, and a field of the wrong kind is not what is expected", () => {
    expect(first(CreateProjectInputSchema, {})).toBe("Name is required.");
    expect(first(CreateProjectInputSchema, { name: 4 })).toBe(
      "Name is not the kind of value expected.",
    );
  });

  test("counts the items of a list, and reads camel case as words", () => {
    const schema = z.object({ repoIds: z.array(z.string()).max(2).min(1) });

    expect(first(schema, { repoIds: ["a", "b", "c"] })).toBe("Repo ids can be at most 2 items.");
    expect(first(schema, { repoIds: [] })).toBe("Repo ids needs at least one item.");
  });

  test("uses a label a person knows the field by", () => {
    const schema = z.object({ repoIds: z.array(z.string()).max(2) });

    expect(first(schema, { repoIds: ["a", "b", "c"] }, { repoIds: "Repositories" })).toBe(
      "Repositories can be at most 2 items.",
    );
  });

  test("names a nested field by its whole path", () => {
    const schema = z.object({ coordinator: z.object({ model: z.string().max(5) }) });

    expect(first(schema, { coordinator: { model: "too long a model" } })).toBe(
      "Coordinator model can be at most 5 characters.",
    );
  });

  test("names the choices of a field that takes one of a few values", () => {
    expect(first(z.object({ level: z.enum(["low", "high"]) }), { level: "max" })).toBe(
      "Level is not one of the choices offered.",
    );
  });

  test("keeps a sentence a schema wrote itself, and rewords zod's own pattern text", () => {
    const own = z.object({ name: z.string().regex(/^a+$/, { error: "Only the letter a." }) });
    const plain = z.object({ name: z.string().regex(/^a+$/) });

    expect(first(own, { name: "b" })).toBe("Only the letter a.");
    expect(first(plain, { name: "b" })).toBe("Name is not in a valid format.");
    expect(
      first(z.object({ ids: z.array(z.string()).refine(() => false, { error: "Nope." }) }), {
        ids: [],
      }),
    ).toBe("Nope.");
  });

  test("reads the JSON copy of an issue a host sent the same way", () => {
    const [issue] = issuesOf(CreateProjectInputSchema, { name: "x".repeat(101) });

    expect(describeIssue(JSON.parse(JSON.stringify(issue)))).toBe(
      "Name can be at most 100 characters.",
    );
  });
});

describe("describeIssuesByField", () => {
  test("gives each field its first sentence and an issue about the whole input the empty key", () => {
    const schema = z.object({ name: z.string().max(3), goal: z.string().max(2) });
    const issues = [
      ...issuesOf(schema, { name: "long", goal: "long" }),
      { code: "custom", path: [], message: "Change something." },
      ...issuesOf(schema, { name: "longer" }),
    ];

    expect(describeIssuesByField(issues)).toEqual({
      name: "Name can be at most 3 characters.",
      goal: "Goal can be at most 2 characters.",
      "": "Change something.",
    });
  });
});

describe("describeFirstIssue", () => {
  test("is the first issue's sentence, or the fallback when there is none", () => {
    const schema = z.object({ name: z.string().max(3), goal: z.string().max(2) });

    expect(describeFirstIssue(issuesOf(schema, { name: "long", goal: "long" }), "Check it")).toBe(
      "Name can be at most 3 characters.",
    );
    expect(describeFirstIssue([], "Check it")).toBe("Check it");
  });
});
