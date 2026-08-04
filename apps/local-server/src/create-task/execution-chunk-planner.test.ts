import { describe, expect, test } from "bun:test";
import { estimateExecutionComplexity, planExecutionChunks } from "./execution-chunk-planner.ts";

describe("create-task/execution-chunk-planner", () => {
  test("plans one execution chunk for a simple single-area task", () => {
    const chunks = planExecutionChunks({
      title: "Disable submit button",
      description: "Hide the submit control on the draft form",
      requirements: [
        "Remove submit button from draft form",
        "Keep save as draft available",
        "Update component tests",
      ],
      acceptanceCriteria: ["Submit button is not visible", "Save draft still works"],
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.title).toBe("Disable submit button");
    expect(chunks[0]?.description).toContain("Remove submit button from draft form");
    expect(chunks[0]?.description).toContain("Update component tests");
  });

  test("groups backend and frontend work for a complex multi-area task", () => {
    const chunks = planExecutionChunks({
      title: "EAV MVP: Pending Sort DESC and Disable Reviewed Tab",
      description: "Adjust pending sort and hide the reviewed tab for the MVP release.",
      requirements: [
        "Change the default pending list sort from addressCreatedAt ascending to descending",
        "Preserve deterministic pagination with a stable property ID tiebreaker",
        "Hide or disable the EAV Reviewed tab in the Command Center UI for MVP",
        "Keep MVP API surface limited to the pending workflow",
        "Update address-validation tests and API documentation",
      ],
      acceptanceCriteria: ["Pending list defaults to newest-first"],
    });

    expect(
      estimateExecutionComplexity({
        title: "EAV MVP: Pending Sort DESC and Disable Reviewed Tab",
        description: "Adjust pending sort and hide the reviewed tab for the MVP release.",
        requirements: [
          "Change the default pending list sort from addressCreatedAt ascending to descending",
          "Preserve deterministic pagination with a stable property ID tiebreaker",
          "Hide or disable the EAV Reviewed tab in the Command Center UI for MVP",
          "Keep MVP API surface limited to the pending workflow",
          "Update address-validation tests and API documentation",
        ],
        acceptanceCriteria: [],
      }),
    ).toBe("complex");

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(3);
    expect(chunks.some((chunk) => /\bbackend\b/i.test(chunk.title))).toBe(true);
    expect(chunks.some((chunk) => /\bfrontend\b/i.test(chunk.title))).toBe(true);
    expect(chunks.every((chunk) => !/complete remaining scope/i.test(chunk.title))).toBe(true);
  });

  test("respects optional executionChunks from brainstorm output", () => {
    const chunks = planExecutionChunks({
      title: "Disable submit button",
      description: "Hide the submit control on the draft form",
      requirements: ["Remove submit button from draft form", "Keep save as draft available"],
      acceptanceCriteria: [],
      executionChunks: ["Disable submit on draft form"],
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.title).toBe("Disable submit on draft form");
    expect(chunks[0]?.description).toContain("Remove submit button from draft form");
  });

  test("distributes requirements across multiple provided execution chunks", () => {
    const chunks = planExecutionChunks({
      title: "EAV MVP",
      description: "Backend sort and frontend tab updates.",
      requirements: [
        "Change backend pending sort default",
        "Hide reviewed tab in Command Center UI",
        "Update address-validation tests and API documentation",
      ],
      acceptanceCriteria: [],
      executionChunks: [
        "Update backend pending query and API contract",
        "Update frontend task list tabs",
        "Verify regressions and documentation",
      ],
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.description).toContain("Change backend pending sort default");
    expect(chunks[1]?.description).toContain("Hide reviewed tab in Command Center UI");
    expect(chunks[2]?.description).toContain(
      "Update address-validation tests and API documentation",
    );
    expect(chunks[0]?.description).not.toContain("Hide reviewed tab");
  });

  test("preserves multiple explicit execution chunks even when scope complexity is simple", () => {
    const requirements = [
      "Change the default pending address-validation list sort so addressCreatedAt is DESC (newest first), retaining the existing property id tiebreaker when timestamps match",
      "Keep explicit client-provided sort parameters working; only the default when no valid sort is supplied should change",
      "Disable the Reviewed tab for address validation so reviewed history is not exposed or navigable through the API surface (endpoint unavailable, feature-flagged off, or equivalent server-side guard)",
      "Update API docs, tests, and any reviewed-tab references in the verified-address module to match the new default sort and disabled Reviewed behavior",
    ];

    expect(
      estimateExecutionComplexity({
        title: "Verified Address Validation Sort and Reviewed Tab Fixes",
        description: "Apply two targeted fixes to the verified-address flow.",
        requirements,
        acceptanceCriteria: [],
      }),
    ).toBe("simple");

    const chunks = planExecutionChunks({
      title: "Verified Address Validation Sort and Reviewed Tab Fixes",
      description: "Apply two targeted fixes to the verified-address flow.",
      requirements,
      acceptanceCriteria: [],
      executionChunks: ["Default pending sort DESC", "Disable reviewed tab API surface"],
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.title).toBe("Default pending sort DESC");
    expect(chunks[1]?.title).toBe("Disable reviewed tab API surface");
    expect(chunks[0]?.description).toContain("addressCreatedAt is DESC");
    expect(chunks[1]?.description).toContain("Reviewed tab");
    expect(chunks[0]?.description).not.toContain("Reviewed tab");
  });

  test("folds small verification work into the owning implementation chunk", () => {
    const chunks = planExecutionChunks({
      title: "Auth Flow",
      description: "Restore the auth workflow",
      requirements: ["Build login handler", "Wire session storage"],
      acceptanceCriteria: ["User can log in"],
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.title).toBe("Auth Flow");
  });
});
