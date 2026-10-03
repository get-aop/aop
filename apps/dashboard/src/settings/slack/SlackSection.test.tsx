import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SLACK_OAUTH_CALLBACK_PATH } from "@aop/common";
import { installInboxHost, makeSlackConnection } from "../../inbox/test-utils";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../../projects/test-utils";
import type { ApiCall } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../../projects/ProjectsProvider");
const { ConfirmationHost } = await import("../../components/ConfirmationHost");
const { SettingsConnections } = await import("./SettingsConnections");

const PASSED = {
  ok: true,
  checks: [
    { id: "user-token", ok: true, detail: "Acme (T1) as @marcelo", fix: null },
    { id: "scopes", ok: true, detail: "13 of 13 scopes", fix: null },
    { id: "app-token", ok: true, detail: "Socket Mode connected", fix: null },
    { id: "groups", ok: true, detail: "2 groups you're in", fix: null },
    {
      id: "events",
      ok: true,
      detail: "Events arrive: your test message reached AOP in 0.4 s",
      fix: null,
    },
  ],
};

let inbox: ReturnType<typeof installInboxHost>;
let opened: string[];
const originalOpen = window.open;

beforeEach(() => {
  opened = [];
  window.open = ((url: string) => {
    opened.push(url);
    return null;
  }) as typeof window.open;
  inbox = installInboxHost((call) => ROUTES[`${call.method} ${call.path.split("?")[0]}`]?.(call));
});

const connected = (patch: Parameters<typeof makeSlackConnection>[0] = {}) => {
  inbox.host.sources = { slack: makeSlackConnection(patch), slackImportAvailable: false };
  return Response.json({ connection: inbox.host.sources.slack });
};

const ROUTES: Record<string, (call: ApiCall) => Response> = {
  "POST /inbox/sources/slack/sign-in": () =>
    Response.json({ authorizeUrl: "https://slack.com/oauth/v2/authorize?client_id=1.2" }),
  "POST /inbox/sources/slack/test": () => Response.json({ report: PASSED }),
  "POST /inbox/sources/slack/import": () => connected(),
  "PUT /inbox/sources/slack": () => connected(),
  "DELETE /inbox/sources/slack": () => {
    inbox.host.sources = { slack: null, slackImportAvailable: false };
    return Response.json({ ok: true });
  },
  "PUT /inbox/sources/slack/notifications": (call) =>
    connected({ notifications: (call.body as { mode: "off" | "away" | "all" }).mode }),
  "GET /settings": () =>
    Response.json({ settings: [{ key: "inbox_retention_days", value: "30" }] }),
  "PUT /settings": () => Response.json({ ok: true }),
};

afterEach(() => {
  cleanup();
  inbox.api.restore();
  window.open = originalOpen;
});

const renderSection = () => {
  const stub = stubLiveProjects(makeState([makeEntry(makeProject({ id: "p1", name: "aop" }), [])]));
  return render(
    <ProjectsProvider live={stub.live}>
      <SettingsConnections />
      <ConfirmationHost />
    </ProjectsProvider>,
  );
};

const disconnected = () => {
  inbox.host.sources = { slack: null, slackImportAvailable: false };
};

describe("connecting Slack", () => {
  test("opens Slack with the manifest (PKCE and Socket Mode on, this host's callback)", async () => {
    disconnected();
    renderSection();
    fireEvent.click(await screen.findByTestId("slack-create-app"));
    const url = new URL(opened[0] ?? "");
    const manifest = url.searchParams.get("manifest_yaml") ?? "";
    expect(url.origin).toBe("https://api.slack.com");
    expect(manifest).toContain("pkce_enabled: true");
    expect(manifest).toContain("socket_mode_enabled: true");
    expect(manifest).toContain(`${window.location.origin}${SLACK_OAUTH_CALLBACK_PATH}`);
  });

  test("signs in with the Client ID and the one app-level token, then waits for Allow", async () => {
    disconnected();
    renderSection();
    fireEvent.change(await screen.findByTestId("slack-client-id"), {
      target: { value: "1111111111.2222222222" },
    });
    fireEvent.change(screen.getByTestId("slack-app-token"), { target: { value: "xapp-1-abc" } });
    fireEvent.click(screen.getByTestId("slack-allow"));
    await screen.findByTestId("slack-waiting");
    expect(inbox.api.writes()).toContainEqual({
      method: "POST",
      path: "/inbox/sources/slack/sign-in",
      body: {
        clientId: "1111111111.2222222222",
        appToken: "xapp-1-abc",
        redirectUrl: `${window.location.origin}${SLACK_OAUTH_CALLBACK_PATH}`,
      },
    });
    expect(opened).toEqual(["https://slack.com/oauth/v2/authorize?client_id=1.2"]);
  });

  test("pasted tokens are saved only after a test that passed, which asks before sending", async () => {
    disconnected();
    renderSection();
    fireEvent.click(await screen.findByText("Paste the two tokens instead"));
    fireEvent.change(screen.getByTestId("slack-user-token"), { target: { value: "xoxp-1" } });
    fireEvent.change(screen.getByTestId("slack-paste-app-token"), { target: { value: "xapp-1" } });
    expect(screen.getByTestId("slack-save").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByTestId("slack-test-send"));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain("your own DM");
    fireEvent.click(within(confirm).getByRole("button", { name: "Send it" }));
    expect((await screen.findByTestId("slack-test-checks")).dataset.ok).toBe("true");
    expect(inbox.api.writes()).toContainEqual({
      method: "POST",
      path: "/inbox/sources/slack/test",
      body: { userToken: "xoxp-1", appToken: "xapp-1", sendTestMessage: true },
    });
    fireEvent.click(screen.getByTestId("slack-save"));
    await screen.findByTestId("slack-connected");
    expect(inbox.api.writes()).toContainEqual({
      method: "PUT",
      path: "/inbox/sources/slack",
      body: { userToken: "xoxp-1", appToken: "xapp-1" },
    });
  });

  test("offers the earlier test's tokens once", async () => {
    inbox.host.sources = { slack: null, slackImportAvailable: true };
    renderSection();
    fireEvent.click(await screen.findByTestId("slack-import-use"));
    await screen.findByTestId("slack-connected");
  });
});

describe("a connected Slack", () => {
  test("says how the feed is doing, with the fix when Slack sends no events", async () => {
    inbox.host.sources = {
      slack: makeSlackConnection({ health: "no-events", problem: "Turn on Socket Mode" }),
      slackImportAvailable: false,
    };
    renderSection();
    expect((await screen.findByTestId("slack-health")).dataset.health).toBe("no-events");
    expect(screen.getByTestId("slack-problem").textContent).toBe("Turn on Socket Mode");
  });

  test("rules switch triggers and add keywords, saved at once", async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId("slack-tab-rules"));
    fireEvent.click(await screen.findByTestId("slack-rule-broadcasts"));
    await waitFor(() => expect(inbox.host.rules.broadcasts).toBe(false));
    fireEvent.change(screen.getByTestId("slack-keyword-input"), {
      target: { value: "deploy-check" },
    });
    fireEvent.click(screen.getByTestId("slack-keyword-add"));
    await waitFor(() => expect(inbox.host.rules.keywords).toEqual(["deploy-check"]));
  });

  test("notifications and how long messages are kept", async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId("slack-tab-notifications"));
    fireEvent.click(await screen.findByTestId("slack-notify-away"));
    await waitFor(() =>
      expect(screen.getByTestId("slack-notify-away").getAttribute("aria-pressed")).toBe("true"),
    );
  });

  test("disconnects, and can delete the stored messages", async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId("slack-disconnect"));
    fireEvent.click(await screen.findByTestId("slack-disconnect-delete"));
    fireEvent.click(screen.getByTestId("slack-disconnect-confirm"));
    await screen.findByTestId("slack-setup");
    expect(inbox.api.writes()).toContainEqual({
      method: "DELETE",
      path: "/inbox/sources/slack?deleteMessages=1",
      body: undefined,
    });
  });
});
