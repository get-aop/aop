/**
 * Fixture data for the fake Jira site (fake-jira.ts): fourteen issues across APP and OPS (WEB has
 * none), the 150 extra OPS issues /__fixture/many adds, and the credentials the site accepts.
 * Times are fixed between 2026-09-25 and 2026-10-02 and all distinct, so "newest first" is
 * visible. Everything a test or script needs is exported from here: the catalog
 * (jira-catalog.ts), the people (jira-people.ts) and the payload builders (jira-payloads.ts).
 */
import type { IssueSpec } from "./jira-catalog.ts";
import { PEOPLE } from "./jira-people.ts";

export * from "./jira-catalog.ts";
export * from "./jira-payloads.ts";
export { type JiraApi, ME, myself, PEOPLE, type Person, personMatches } from "./jira-people.ts";

export const FIXTURE_EMAIL = "fixture@example.com";
export const FIXTURE_API_TOKEN = "jira_fixture_token";
export const FIXTURE_PAT = "jira_pat_fixture";
/** The Authorization header Jira Cloud accepts for the fixture account. */
export const cloudAuthorization = () => `Basic ${btoa(`${FIXTURE_EMAIL}:${FIXTURE_API_TOKEN}`)}`;
/** The Authorization header Jira Data Center accepts for the fixture personal access token. */
export const dcAuthorization = () => `Bearer ${FIXTURE_PAT}`;

const { sam, priya, marcus, lena, devon, tomas } = PEOPLE;
let nextId = 10001;
const issue = (
  key: string,
  summary: string,
  shape: Pick<IssueSpec, "type" | "status" | "priority" | "assignee" | "reporter"> &
    Partial<Pick<IssueSpec, "labels" | "components" | "fixVersion" | "resolution">>,
  created: string,
  updated: string,
): IssueSpec => ({
  id: String(nextId++),
  key,
  summary,
  labels: [],
  components: [],
  fixVersion: false,
  resolution: shape.status === "done" ? "Done" : null,
  ...shape,
  created: `${created}.000Z`,
  updated: `${updated}.000Z`,
});

export const ISSUES: IssueSpec[] = [
  issue(
    "APP-1",
    "Login screen freezes after the Face ID prompt is dismissed",
    {
      type: "Bug",
      status: "progress",
      priority: "High",
      assignee: sam,
      reporter: priya,
      labels: ["ios", "auth"],
      components: ["Authentication"],
      fixVersion: true,
    },
    "2026-09-22T09:14:02",
    "2026-10-02T09:41:27",
  ),
  issue(
    "APP-2",
    "Offline mode for saved articles",
    {
      type: "Story",
      status: "todo",
      priority: "Medium",
      assignee: lena,
      reporter: tomas,
      labels: ["offline"],
      fixVersion: true,
    },
    "2026-09-18T11:20:45",
    "2026-09-30T16:05:12",
  ),
  issue(
    "APP-3",
    "Reply notification opens the inbox instead of the thread on Android 15",
    {
      type: "Bug",
      status: "review",
      priority: "Highest",
      assignee: marcus,
      reporter: sam,
      labels: ["android", "notifications"],
      components: ["Notifications"],
      fixVersion: true,
    },
    "2026-09-24T08:02:33",
    "2026-10-01T18:22:50",
  ),
  issue(
    "APP-4",
    "Upgrade React Native to 0.79",
    {
      type: "Task",
      status: "todo",
      priority: "Low",
      assignee: null,
      reporter: marcus,
      labels: ["tech-debt"],
    },
    "2026-09-10T15:47:19",
    "2026-09-25T10:12:08",
  ),
  issue(
    "APP-5",
    "Settings toggles fail contrast in dark mode",
    {
      type: "Bug",
      status: "done",
      priority: "Medium",
      assignee: devon,
      reporter: lena,
      labels: ["a11y"],
      components: ["Settings"],
    },
    "2026-09-15T13:30:00",
    "2026-09-29T11:48:36",
  ),
  issue(
    "APP-6",
    "Symbolicate crash reports from release builds",
    {
      type: "Task",
      status: "progress",
      priority: "High",
      assignee: sam,
      reporter: sam,
      labels: ["observability"],
    },
    "2026-09-20T10:05:41",
    "2026-10-01T07:33:19",
  ),
  issue(
    "APP-7",
    "Review the onboarding carousel copy",
    {
      type: "Task",
      status: "done",
      priority: "Lowest",
      assignee: tomas,
      reporter: priya,
      components: ["Onboarding"],
      resolution: "Won't Do",
    },
    "2026-09-08T09:00:12",
    "2026-09-26T14:03:11",
  ),
  issue(
    "APP-8",
    "Open campaign email links in the app",
    {
      type: "Story",
      status: "todo",
      priority: null,
      assignee: sam,
      reporter: lena,
      labels: ["growth"],
    },
    "2026-09-27T16:40:05",
    "2026-09-28T14:03:11",
  ),
  issue(
    "OPS-1",
    "Rotate the staging database credentials",
    {
      type: "Task",
      status: "todo",
      priority: "Highest",
      assignee: sam,
      reporter: marcus,
      labels: ["security"],
      components: ["Database"],
    },
    "2026-09-29T08:15:27",
    "2026-10-02T08:02:44",
  ),
  issue(
    "OPS-2",
    "Nightly backup job overruns its window",
    {
      type: "Bug",
      status: "progress",
      priority: "High",
      assignee: marcus,
      reporter: priya,
      labels: ["backups"],
      components: ["Database"],
    },
    "2026-09-26T07:55:03",
    "2026-10-01T22:10:05",
  ),
  issue(
    "OPS-3",
    "Move build runners to arm64",
    {
      type: "Epic",
      status: "review",
      priority: "Medium",
      assignee: lena,
      reporter: sam,
      labels: ["cost"],
      components: ["CI"],
    },
    "2026-09-01T12:00:00",
    "2026-09-30T09:27:58",
  ),
  issue(
    "OPS-4",
    "Alert 14 days before a certificate expires",
    {
      type: "Task",
      status: "done",
      priority: "Low",
      assignee: priya,
      reporter: marcus,
      components: ["Monitoring"],
    },
    "2026-09-12T10:10:10",
    "2026-09-27T17:51:22",
  ),
  issue(
    "OPS-5",
    "Trim application log retention to 30 days",
    {
      type: "Task",
      status: "todo",
      priority: "Lowest",
      assignee: tomas,
      reporter: lena,
      labels: ["compliance"],
    },
    "2026-09-21T14:44:44",
    "2026-09-25T15:36:09",
  ),
  issue(
    "OPS-6",
    "Postmortem: API latency spike on 2026-09-19",
    {
      type: "Task",
      status: "done",
      priority: "Medium",
      assignee: sam,
      reporter: lena,
      labels: ["postmortem"],
    },
    "2026-09-19T15:02:00",
    "2026-09-29T19:14:47",
  ),
];

/** 150 old open OPS issues for /__fixture/many, so a list spans pages of 100. */
export function manyIssues(): IssueSpec[] {
  const chores = ["Remove stale alert rule", "Archive unused bucket", "Delete orphaned DNS record"];
  return Array.from({ length: 150 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 5, 1, 9) + index * 13 * 3_600_000)
      .toISOString()
      .slice(0, 19);
    return {
      ...issue(
        `OPS-${7 + index}`,
        `${chores[index % chores.length]} #${index + 1}`,
        {
          type: "Task",
          status: "todo",
          priority: "Low",
          assignee: index % 2 ? null : sam,
          reporter: priya,
          labels: ["cleanup"],
        },
        day,
        day,
      ),
      id: String(20000 + index),
    };
  });
}
