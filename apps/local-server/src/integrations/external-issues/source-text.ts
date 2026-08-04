import type { JiraResolvedIssue } from "../jira/types.ts";
import type { LinearResolvedIssue } from "../linear/types.ts";

export const buildLinearIssueSourceText = (issue: LinearResolvedIssue): string => {
  const lines = [
    "Provider: Linear",
    `Issue ref: ${issue.ref}`,
    `Title: ${issue.title}`,
    `URL: ${issue.url}`,
  ];

  if (issue.description?.trim()) {
    lines.push("", "Description:", issue.description.trim());
  }

  const metadata = [
    issue.team ? `Team: ${issue.team.name} (${issue.team.key})` : null,
    issue.project ? `Project: ${issue.project.name}` : null,
    issue.state ? `State: ${issue.state.name}` : null,
    issue.priority !== null ? `Priority: ${mapLinearPriorityLabel(issue.priority)}` : null,
  ].filter((line): line is string => typeof line === "string");

  if (metadata.length > 0) {
    lines.push("", ...metadata);
  }

  if (issue.blocks.length > 0) {
    lines.push("", "Blockers:");
    for (const blocker of issue.blocks) {
      lines.push(`- ${blocker.ref}: ${blocker.title} (${blocker.url})`);
    }
  }

  return lines.join("\n");
};

export const buildJiraIssueSourceText = (issue: JiraResolvedIssue): string => {
  const lines = [
    "Provider: Jira",
    `Issue ref: ${issue.ref}`,
    `Title: ${issue.title}`,
    `URL: ${issue.url}`,
  ];

  if (issue.description?.trim()) {
    lines.push("", "Description:", issue.description.trim());
  }

  const metadata = [
    issue.project ? `Project: ${issue.project.name} (${issue.project.key})` : null,
    issue.status ? `Status: ${issue.status.name}` : null,
    issue.team ? `Team: ${issue.team.name}` : null,
    issue.priority ? `Priority: ${issue.priority.name}` : null,
  ].filter((line): line is string => typeof line === "string");

  if (metadata.length > 0) {
    lines.push("", ...metadata);
  }

  if (issue.blocks.length > 0) {
    lines.push("", "Blockers:");
    for (const blocker of issue.blocks) {
      lines.push(`- ${blocker.ref}: ${blocker.title} (${blocker.url})`);
    }
  }

  return lines.join("\n");
};

const mapLinearPriorityLabel = (priority: number): string => {
  switch (priority) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "none";
  }
};
