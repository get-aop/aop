import type { PullRequestMergeMethod } from "@aop/common";

/**
 * What the rulesets that apply to the base branch ask of a merge (`GET repos/o/r/rules/branches/b`).
 * Classic branch protection is not readable without admin rights; GitHub folds it into the pull
 * request's merge state and its checks' `isRequired`, which the merge box reads as well.
 */
export interface BranchRules {
  requiredApprovals: number;
  /** Check names the rules require; one the head never reported blocks the merge too. */
  requiredChecks: string[];
  requireThreadResolution: boolean;
  /** Null when no rule narrows the repository's own merge settings. */
  allowedMethods: PullRequestMergeMethod[] | null;
}

export const NO_RULES: BranchRules = {
  requiredApprovals: 0,
  requiredChecks: [],
  requireThreadResolution: false,
  allowedMethods: null,
};

interface RawRule {
  type?: unknown;
  parameters?: Record<string, unknown> | null;
}

/** The rules GitHub listed, folded together: the strictest of each wins. */
export const parseBranchRules = (body: unknown): BranchRules => {
  if (!Array.isArray(body)) return NO_RULES;
  return (body as RawRule[]).reduce<BranchRules>(foldRule, NO_RULES);
};

const foldRule = (rules: BranchRules, rule: RawRule): BranchRules => {
  const parameters = rule.parameters ?? {};
  if (rule.type === "pull_request") {
    const methods = methodsOf(parameters.allowed_merge_methods);
    return {
      ...rules,
      requiredApprovals: Math.max(
        rules.requiredApprovals,
        numberOf(parameters.required_approving_review_count),
      ),
      requireThreadResolution:
        rules.requireThreadResolution || parameters.required_review_thread_resolution === true,
      allowedMethods: methods ? intersect(rules.allowedMethods, methods) : rules.allowedMethods,
    };
  }
  if (rule.type === "required_status_checks") {
    const checks = Array.isArray(parameters.required_status_checks)
      ? (parameters.required_status_checks as { context?: unknown }[])
          .map((check) => check.context)
          .filter((context): context is string => typeof context === "string")
      : [];
    return { ...rules, requiredChecks: [...new Set([...rules.requiredChecks, ...checks])] };
  }
  return rules;
};

const METHODS: readonly PullRequestMergeMethod[] = ["squash", "merge", "rebase"];

const methodsOf = (value: unknown): PullRequestMergeMethod[] | null =>
  Array.isArray(value) ? METHODS.filter((method) => value.includes(method)) : null;

const intersect = (
  current: PullRequestMergeMethod[] | null,
  next: PullRequestMergeMethod[],
): PullRequestMergeMethod[] =>
  current === null ? next : current.filter((method) => next.includes(method));

const numberOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
