import { describe, expect, test } from "bun:test";
import { NO_RULES, parseBranchRules } from "./rules.ts";

describe("parseBranchRules", () => {
  test("reads approvals, required checks, thread resolution and merge methods", () => {
    // What GitHub answered for get-aop/aop's main, plus a second ruleset that narrows it.
    const rules = parseBranchRules([
      { type: "deletion", parameters: null },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          required_review_thread_resolution: false,
          allowed_merge_methods: ["merge", "squash", "rebase"],
        },
      },
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "ci", integration_id: 15368 }] },
      },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 1,
          required_review_thread_resolution: true,
          allowed_merge_methods: ["squash"],
        },
      },
    ]);
    expect(rules).toEqual({
      requiredApprovals: 1,
      requiredChecks: ["ci"],
      requireThreadResolution: true,
      allowedMethods: ["squash"],
    });
  });

  test("no rules, or an answer that is not a list, leaves the repository's settings alone", () => {
    expect(parseBranchRules([])).toEqual(NO_RULES);
    expect(parseBranchRules({ message: "Not Found" })).toEqual(NO_RULES);
  });
});
