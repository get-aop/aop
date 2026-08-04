import { describe, expect, test } from "bun:test";
import { estimateTaskScopeComplexity } from "./normalize-scope.ts";

describe("create-task/normalize-scope", () => {
  test("classifies a single-area task as simple", () => {
    expect(
      estimateTaskScopeComplexity({
        title: "Disable submit button",
        description: "Hide submit on the draft form.",
        requirements: ["Remove submit button from draft form"],
        acceptanceCriteria: ["Submit is hidden"],
      }),
    ).toBe("simple");
  });

  test("classifies multi-system work as complex", () => {
    expect(
      estimateTaskScopeComplexity({
        title: "EAV MVP updates",
        description:
          "Adjust backend pending sort, hide reviewed tab in UI, and update OpenAPI docs for the address-validation workflow across API and frontend components.",
        requirements: [
          "Change backend pending sort default",
          "Hide reviewed tab in UI",
          "Update OpenAPI docs",
          "Update backend tests",
          "Update frontend tests",
        ],
        acceptanceCriteria: [],
      }),
    ).toBe("complex");
  });

  test("classifies mid-sized multi-area work as standard", () => {
    expect(
      estimateTaskScopeComplexity({
        title: "Add export button",
        description: "Add an export button to the frontend that calls the backend api endpoint.",
        requirements: ["Add export button to frontend", "Expose backend api endpoint"],
        acceptanceCriteria: ["Button triggers export"],
      }),
    ).toBe("standard");
  });
});
