/**
 * The parts of a zod issue that say what is wrong: a schema's own issue on the host or in a
 * client, or the JSON copy of one a host sends in a 400.
 */
export interface ValidationIssue {
  code: string;
  path: readonly PropertyKey[];
  message: string;
  origin?: string;
  maximum?: number | bigint;
  minimum?: number | bigint;
}

/** Field names a person knows by another word than the schema's key. */
export type FieldLabels = Readonly<Record<string, string>>;

/**
 * One plain sentence for an issue that names the field, in place of zod's own wording
 * ("Too big: expected string to have <=100 characters"). A message a schema wrote itself is
 * already a sentence and stays as it is.
 */
export const describeIssue = (issue: ValidationIssue, labels: FieldLabels = {}): string => {
  const label = labelOf(issue.path, labels);
  switch (issue.code) {
    case "too_big":
      return `${label} can be at most ${sizeOf(issue, issue.maximum)}.`;
    case "too_small":
      return tooSmall(issue, label);
    case "invalid_type":
      return issue.message.endsWith("received undefined")
        ? `${label} is required.`
        : `${label} is not the kind of value expected.`;
    case "invalid_value":
      return `${label} is not one of the choices offered.`;
    case "invalid_format":
      return issue.message.startsWith("Invalid ")
        ? `${label} is not in a valid format.`
        : issue.message;
    default:
      return issue.message;
  }
};

/** The sentence for the first issue, for a form or response that has room for one message. */
export const describeFirstIssue = (
  issues: readonly ValidationIssue[],
  fallback: string,
  labels: FieldLabels = {},
): string => {
  const [issue] = issues;
  return issue ? describeIssue(issue, labels) : fallback;
};

/**
 * The first sentence for each field, keyed by the top-level field it is about; an issue about
 * the whole input has no field and is under the empty key.
 */
export const describeIssuesByField = (
  issues: readonly ValidationIssue[],
  labels: FieldLabels = {},
): Record<string, string> => {
  const byField: Record<string, string> = {};
  for (const issue of issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "";
    byField[field] ??= describeIssue(issue, labels);
  }
  return byField;
};

const tooSmall = (issue: ValidationIssue, label: string): string => {
  const minimum = Number(issue.minimum);
  if (issue.origin === "string") {
    return minimum <= 1
      ? `${label} is required.`
      : `${label} needs at least ${minimum} characters.`;
  }
  if (issue.origin === "array") {
    return minimum <= 1
      ? `${label} needs at least one item.`
      : `${label} needs at least ${minimum} items.`;
  }
  return `${label} must be at least ${minimum}.`;
};

const sizeOf = (issue: ValidationIssue, maximum: number | bigint | undefined): string => {
  if (issue.origin === "string") return `${maximum} characters`;
  if (issue.origin === "array") return `${maximum} items`;
  return String(maximum);
};

// "coordinator.model" reads "Coordinator model"; array positions add nothing a person can use.
const labelOf = (path: readonly PropertyKey[], labels: FieldLabels): string => {
  const [first, ...rest] = path.filter((segment): segment is string => typeof segment === "string");
  if (first === undefined) return "This value";
  const words = [labels[first] ?? humanize(first), ...rest.map(humanize)].join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const humanize = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
