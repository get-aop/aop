import type { JiraIssueKeyList } from "./types.ts";

const JIRA_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;
const JIRA_KEY_IN_TEXT_PATTERN = /\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/g;

export const parseJiraIssueInput = (input: string): JiraIssueKeyList => {
  const keys = new Set<string>();

  for (const match of input.matchAll(JIRA_KEY_IN_TEXT_PATTERN)) {
    if (match[1]) {
      keys.add(normalizeJiraIssueKey(match[1]));
    }
  }

  if (keys.size === 0) {
    throw new Error(`Invalid Jira issue reference: ${input}`);
  }

  return { keys: [...keys] };
};

export const normalizeJiraIssueKey = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(JIRA_KEY_PATTERN);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid Jira issue reference: ${value}`);
  }

  return `${match[1].toUpperCase()}-${match[2]}`;
};
