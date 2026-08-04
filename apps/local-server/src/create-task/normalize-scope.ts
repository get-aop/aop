import type { BrainstormingResult } from "@aop/common";
import { dedupeTrimmedItems } from "./scope-utils.ts";

export type TaskScopeComplexity = "simple" | "standard" | "complex";

const COMPLEXITY_DOMAIN_PATTERN =
  /\b(backend|frontend|api|ui|database|migration|integrat|e2e|openapi|service|component|workflow)\b/gi;

export const estimateTaskScopeComplexity = (result: BrainstormingResult): TaskScopeComplexity => {
  const requirements = dedupeTrimmedItems(result.requirements);
  const text = `${result.title} ${result.description} ${requirements.join(" ")}`;

  let score = 0;
  if (requirements.length >= 5) score += 2;
  else if (requirements.length >= 3) score += 1;

  if (result.description.length > 350) score += 1;

  const domainMatches = text.match(COMPLEXITY_DOMAIN_PATTERN) ?? [];
  const uniqueDomains = new Set(domainMatches.map((match) => match.toLowerCase()));
  if (uniqueDomains.size >= 3) score += 2;
  else if (uniqueDomains.size >= 2) score += 1;

  if (requirements.some((item) => /\band\b.*\band\b/i.test(item))) score += 1;

  if (score >= 4) return "complex";
  if (score <= 1 && requirements.length <= 2) return "simple";
  return "standard";
};

export { dedupeTrimmedItems };
