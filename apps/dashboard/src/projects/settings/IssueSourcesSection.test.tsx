import { afterEach, describe, expect, test } from "bun:test";
import { JIRA_NOT_CONNECTED } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, screen, waitFor } = await import("@testing-library/react");
const { IssueSourcesSection } = await import("./IssueSourcesSection");
const { renderSection } = await import("./section-test-utils");

const project = makeProject({ id: "p1", name: "Checkout" });

afterEach(() => cleanup());

describe("the Issue sources settings", () => {
  test("names what each tracker shows, and opens the same dialog as the Issues tab", async () => {
    await renderSection(IssueSourcesSection, project, (call) => {
      if (call.path === "/auth/me") return Response.json({ kind: "owner" });
      if (call.path === "/projects/p1/linear") {
        return Response.json({
          connection: { configured: false, scope: null, workspace: null, viewer: null },
        });
      }
      if (call.path === "/projects/p1/jira") {
        return Response.json({
          connection: {
            ...JIRA_NOT_CONNECTED,
            configured: true,
            deployment: "cloud",
            siteUrl: "https://acme.atlassian.net",
            account: "Sam Rivera",
            filter: { projects: ["APP", "OPS"], jql: null },
          },
        });
      }
      return undefined;
    });
    await waitFor(() =>
      expect(screen.getByTestId("settings-issue-source-jira").textContent).toContain(
        "acme.atlassian.net as Sam Rivera: APP, OPS.",
      ),
    );
    expect(screen.getByTestId("settings-issue-source-linear").textContent).toContain(
      "Not connected.",
    );
    expect(screen.getByTestId("settings-linear").textContent).toBe("Connect");
    expect(screen.getByTestId("settings-jira").textContent).toBe("Manage");

    fireEvent.click(screen.getByTestId("settings-jira"));
    expect(await screen.findByTestId("jira-connected")).toBeTruthy();
  });
});
