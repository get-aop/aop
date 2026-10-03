import type { IssueDetail } from "@aop/common";
import type { JiraApi, JiraRead } from "./jira-api.ts";
import type { StoredJiraConnection } from "./jira-connection-store.ts";
import { commentsOf, mapJiraIssue, markdownOf, sectionsOf } from "./jira-mapping.ts";

/**
 * One Jira issue whole, read fresh: its row, its description and acceptance criteria as
 * Markdown, and its latest comments. Null when the token cannot see an issue with that key.
 */
export const readJiraDetail = async (
  api: JiraApi,
  connection: StoredJiraConnection,
  issueKey: string,
): Promise<JiraRead<IssueDetail | null>> => {
  const read = await api.issue(connection.credentials, issueKey);
  if (!read.ok || read.value === null) return read as JiraRead<null>;
  const { issue, names } = read.value;
  const fields = issue.fields ?? {};
  const { comments, total } = commentsOf(fields.comment);
  return {
    ok: true,
    value: {
      issue: { ...mapJiraIssue(issue, connection.credentials), commentCount: total },
      body: markdownOf(fields.description),
      sections: sectionsOf(fields, names),
      comments,
      commentCount: total,
    },
  };
};
