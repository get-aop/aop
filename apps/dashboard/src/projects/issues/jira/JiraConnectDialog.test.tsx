import { afterEach, describe, expect, test } from "bun:test";
import { JIRA_NOT_CONNECTED, type JiraConnection } from "@aop/common";
import { type ApiCall, mockApi } from "../../../test/mock-api";
import { setupDashboardDom } from "../../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { JiraConnectDialog } = await import("./JiraConnectDialog");

const CONNECTED: JiraConnection = {
  configured: true,
  deployment: "cloud",
  siteUrl: "https://acme.atlassian.net",
  account: "Sam Rivera",
  filter: { projects: ["APP"], jql: null },
  linkPullRequests: true,
};

const RESULT = {
  account: { displayName: "Sam Rivera", email: "sam@acme.test", avatarUrl: null },
  projects: [
    { key: "APP", name: "Mobile App" },
    { key: "OPS", name: "Operations" },
  ],
};

const refused = () =>
  Response.json(
    {
      error: "Jira refused the token: it may have expired or been revoked",
      code: "JIRA_UNAUTHORIZED",
    },
    { status: 422 },
  );

let api: ReturnType<typeof mockApi> | null = null;

/** The dialog over a host whose Jira connection is `start`; `respond` answers the rest. */
const renderDialog = async (
  start: JiraConnection,
  options: { owner?: boolean; respond?: (call: ApiCall) => Response | undefined } = {},
) => {
  let changed = 0;
  const routes: Record<string, (call: ApiCall) => Response> = {
    "GET /projects/p1/jira": () => Response.json({ connection: start }),
    "POST /projects/p1/jira/test": (call) => {
      const credentials = (call.body as { credentials?: { apiToken?: string } }).credentials;
      return credentials?.apiToken === "bad" ? refused() : Response.json({ result: RESULT });
    },
    "PUT /projects/p1/jira": (call) => {
      const body = call.body as Pick<JiraConnection, "filter" | "linkPullRequests">;
      return Response.json({
        connection: { ...CONNECTED, filter: body.filter, linkPullRequests: body.linkPullRequests },
      });
    },
    "DELETE /projects/p1/jira": () => new Response(null, { status: 204 }),
  };
  api = mockApi((call) => options.respond?.(call) ?? routes[`${call.method} ${call.path}`]?.(call));
  render(
    <JiraConnectDialog
      projectId="p1"
      open
      owner={options.owner ?? true}
      onOpenChange={() => {}}
      onChanged={() => {
        changed += 1;
      }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByTestId("jira-dialog").textContent).not.toContain("Checking the connection"),
  );
  return { changes: () => changed };
};

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const fillCloud = (token = "tok_123") => {
  type("jira-site", "https://acme.atlassian.net/");
  type("jira-email", "sam@acme.test");
  type("jira-token", token);
};

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("connecting Jira", () => {
  test("the owner tests Cloud credentials, sees the account, picks projects and connects", async () => {
    const view = await renderDialog(JIRA_NOT_CONNECTED);
    const token = screen.getByTestId("jira-token") as HTMLInputElement;
    expect(token.type).toBe("text");
    expect(token.getAttribute("autocomplete")).toBe("off");

    fillCloud();
    expect((screen.getByTestId("jira-continue") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("jira-test"));
    expect((await screen.findByTestId("jira-test-ok")).textContent).toContain(
      "Signed in as Sam Rivera (sam@acme.test)",
    );
    fireEvent.click(screen.getByTestId("jira-continue"));

    const options = await screen.findAllByTestId("jira-project-option");
    expect(options.map((option) => option.dataset.key)).toEqual(["APP", "OPS"]);
    expect((screen.getByTestId("jira-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(options[1]?.querySelector("input") as HTMLInputElement);
    fireEvent.click(screen.getByTestId("jira-save"));

    expect(await screen.findByTestId("jira-connected")).toBeTruthy();
    expect(screen.getByTestId("jira-connected-filter").textContent).toBe("Open issues of OPS");
    expect(view.changes()).toBe(1);
    const credentials = {
      deployment: "cloud",
      siteUrl: "https://acme.atlassian.net",
      email: "sam@acme.test",
      apiToken: "tok_123",
    };
    expect(api?.writes()).toEqual([
      { method: "POST", path: "/projects/p1/jira/test", body: { credentials } },
      {
        method: "PUT",
        path: "/projects/p1/jira",
        body: { credentials, filter: { projects: ["OPS"], jql: null }, linkPullRequests: true },
      },
    ]);
  });

  test("a refused token says so and keeps Continue off; changing a field asks for a new test", async () => {
    await renderDialog(JIRA_NOT_CONNECTED);
    fillCloud("bad");
    fireEvent.click(screen.getByTestId("jira-test"));
    expect((await screen.findByTestId("jira-test-failed")).textContent).toContain(
      "Jira refused these credentials",
    );
    expect((screen.getByTestId("jira-continue") as HTMLButtonElement).disabled).toBe(true);

    type("jira-token", "good");
    fireEvent.click(screen.getByTestId("jira-test"));
    await screen.findByTestId("jira-test-ok");
    type("jira-token", "good2");
    expect(screen.getByTestId("jira-test-ok").textContent).toContain("test again");
    expect((screen.getByTestId("jira-continue") as HTMLButtonElement).disabled).toBe(true);
  });

  test("Data Center signs in with a personal access token and no email", async () => {
    await renderDialog(JIRA_NOT_CONNECTED);
    fireEvent.click(
      screen.getByTestId("jira-deployment-datacenter").querySelector("input") as HTMLInputElement,
    );
    expect(screen.queryByTestId("jira-email")).toBeNull();
    type("jira-site", "https://jira.acme.test");
    type("jira-token", "pat_1");
    fireEvent.click(screen.getByTestId("jira-test"));
    await screen.findByTestId("jira-test-ok");
    expect(api?.writes()[0]?.body).toEqual({
      credentials: { deployment: "datacenter", siteUrl: "https://jira.acme.test", token: "pat_1" },
    });
  });

  test("an advanced JQL query is saved with the projects, and a query Jira refuses is shown", async () => {
    await renderDialog(CONNECTED, {
      respond: (call) =>
        call.method === "PUT" && (call.body as { filter: { jql: string } }).filter.jql === "bogus"
          ? Response.json(
              {
                error: "Jira did not accept the filter: Field 'bogus' does not exist.",
                code: "JIRA_BAD_FILTER",
              },
              { status: 422 },
            )
          : undefined,
    });
    fireEvent.click(screen.getByTestId("jira-change-filter"));
    await screen.findAllByTestId("jira-project-option");
    fireEvent.click(screen.getByTestId("jira-jql-open"));
    type("jira-jql", "bogus");
    fireEvent.click(screen.getByTestId("jira-save"));
    expect((await screen.findByTestId("jira-error")).textContent).toContain("Field 'bogus'");

    type("jira-jql", "assignee = currentUser()");
    fireEvent.click(screen.getByTestId("jira-link-prs"));
    fireEvent.click(screen.getByTestId("jira-save"));
    await screen.findByTestId("jira-connected");
    expect(api?.writes().at(-1)?.body).toEqual({
      filter: { projects: ["APP"], jql: "assignee = currentUser()" },
      linkPullRequests: false,
    });
  });

  test("testing a saved token Jira now refuses offers to reconnect with a new one", async () => {
    await renderDialog(CONNECTED, {
      respond: (call) => (call.path === "/projects/p1/jira/test" ? refused() : undefined),
    });
    fireEvent.click(screen.getByTestId("jira-test-saved"));
    expect((await screen.findByTestId("jira-test-failed")).textContent).toContain(
      "Jira refused the saved token",
    );
    fireEvent.click(screen.getByTestId("jira-reconnect"));
    expect((screen.getByTestId("jira-site") as HTMLInputElement).value).toBe(
      "https://acme.atlassian.net",
    );
    fireEvent.click(screen.getByTestId("jira-back"));
    expect(screen.getByTestId("jira-connected")).toBeTruthy();
  });

  test("disconnecting asks once more, then removes the token", async () => {
    const view = await renderDialog(CONNECTED);
    fireEvent.click(screen.getByTestId("jira-disconnect"));
    expect(screen.getByTestId("jira-disconnect-confirm").textContent).toContain("Delete the token");
    fireEvent.click(screen.getByTestId("jira-disconnect-confirmed"));
    await screen.findByTestId("jira-site");
    expect(api?.writes()).toEqual([
      { method: "DELETE", path: "/projects/p1/jira", body: undefined },
    ]);
    expect(view.changes()).toBe(1);
  });

  test("a paired device sees what is connected, and that only the owner can change it", async () => {
    await renderDialog(CONNECTED, { owner: false });
    expect(screen.getByTestId("jira-connected")).toBeTruthy();
    expect(screen.queryByTestId("jira-disconnect")).toBeNull();
    cleanup();
    api?.restore();

    await renderDialog(JIRA_NOT_CONNECTED, { owner: false });
    expect(screen.getByTestId("jira-owner-only")).toBeTruthy();
    expect(screen.queryByTestId("jira-token")).toBeNull();
  });
});
