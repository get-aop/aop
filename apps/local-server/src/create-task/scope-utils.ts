export type WorkArea = "backend" | "frontend" | "verification" | "general";

const BACKEND_PATTERN =
  /\b(backend|api|endpoint|service|query|database|migration|sort|pagination|controller|openapi|contract|server)\b/i;
const FRONTEND_PATTERN =
  /\b(frontend|ui|tab|component|button|form|page|screen|command center|cc ui|navigat|visible|hide|display)\b/i;
const VERIFICATION_PATTERN =
  /\b(test|spec|coverage|documentation|docs|verify|regression|e2e|unit test|integration test)\b/i;

export const dedupeTrimmedItems = (items: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
};

export const classifyWorkArea = (text: string): WorkArea => {
  const backendScore = countPatternMatches(text, BACKEND_PATTERN);
  const frontendScore = countPatternMatches(text, FRONTEND_PATTERN);
  const verificationScore = countPatternMatches(text, VERIFICATION_PATTERN);

  if (backendScore === 0 && frontendScore === 0 && verificationScore > 0) {
    return "verification";
  }

  if (backendScore >= frontendScore && backendScore > 0) return "backend";
  if (frontendScore > 0) return "frontend";
  if (verificationScore > 0) return "verification";
  return "general";
};

export const countImplementationAreas = (requirements: string[]): number => {
  const areas = new Set<WorkArea>();

  for (const requirement of requirements) {
    const area = classifyWorkArea(requirement);
    if (area === "verification" || area === "general") continue;
    areas.add(area);
  }

  return areas.size;
};

const countPatternMatches = (text: string, pattern: RegExp): number =>
  text.match(new RegExp(pattern.source, "gi"))?.length ?? 0;
