import { afterEach, describe, expect, test } from "bun:test";
import type { LinearConnection } from "@aop/common";
import { type ApiCall, mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { LinearConnectDialog } = await import("./LinearConnectDialog");

const NONE: LinearConnection = { configured: false, scope: null, workspace: null, viewer: null };
const CONNECTED: LinearConnection = {
  configured: true,
  scope: { kind: "team", id: "t1", name: "Engineering" },
  workspace: "Acme",
  viewer: "sam",
};
const CATALOG = {
  workspace: "Acme",
  viewer: "sam",
  teams: [
    { id: "t1", key: "ENG", name: "Engineering" },
    { id: "t2", key: "OPS", name: "Operations" },
  ],
  projects: [{ id: "p9", name: "Beta", teams: ["ENG"] }],
};

let api: ReturnType<typeof mockApi> | null = null;

/** The dialog over a host whose Linear connection is `start`; `respond` answers the rest. */
const renderDialog = async (
  start: LinearConnection,
  options: { owner?: boolean; respond?: (call: ApiCall) => Response | undefined } = {},
) => {
  let changed = 0;
  const routes: Record<string, (call: ApiCall) => Response> = {
    "GET /projects/p1/linear": () => Response.json({ connection: start }),
    "POST /projects/p1/linear/catalog": (call) =>
      (call.body as { apiKey?: string }).apiKey === "bad"
        ? Response.json(
            { error: "Linear refused the API key", code: "LINEAR_UNAUTHORIZED" },
            { status: 422 },
          )
        : Response.json({ catalog: CATALOG }),
    "PUT /projects/p1/linear": (call) =>
      Response.json({ connection: { ...CONNECTED, scope: (call.body as LinearConnection).scope } }),
    "DELETE /projects/p1/linear": () => new Response(null, { status: 204 }),
  };
  api = mockApi((call) => options.respond?.(call) ?? routes[`${call.method} ${call.path}`]?.(call));
  render(
    <LinearConnectDialog
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
    expect(screen.getByTestId("linear-dialog").textContent).not.toContain(
      "Checking the connection",
    ),
  );
  return { changes: () => changed };
};

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("connecting Linear", () => {
  test("the owner pastes a key, picks a team or project, and connects", async () => {
    const view = await renderDialog(NONE);

    const key = screen.getByTestId("linear-api-key") as HTMLInputElement;
    expect(key.type).toBe("text");
    fireEvent.change(key, { target: { value: " lin_api_good " } });
    fireEvent.click(screen.getByTestId("linear-check-key"));

    await screen.findByTestId("linear-scopes");
    expect(
      screen.getAllByTestId("linear-scope-option").map((option) => option.dataset.scope),
    ).toEqual(["team:t1", "team:t2", "project:p9"]);
    fireEvent.click(
      screen.getAllByTestId("linear-scope-option")[2]?.querySelector("input") as HTMLElement,
    );
    fireEvent.click(screen.getByTestId("linear-save"));

    expect((await screen.findByTestId("linear-scope")).textContent).toBe("Beta");
    expect(api?.writes()).toEqual([
      { method: "POST", path: "/projects/p1/linear/catalog", body: { apiKey: "lin_api_good" } },
      {
        method: "PUT",
        path: "/projects/p1/linear",
        body: { apiKey: "lin_api_good", scope: { kind: "project", id: "p9", name: "Beta" } },
      },
    ]);
    expect(view.changes()).toBe(1);
  });

  test("a refused key says so and stays on the key step", async () => {
    await renderDialog(NONE);
    fireEvent.change(screen.getByTestId("linear-api-key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByTestId("linear-check-key"));
    expect((await screen.findByTestId("linear-error")).textContent).toBe(
      "Linear refused the API key",
    );
    expect(screen.getByTestId("linear-api-key")).toBeTruthy();
  });

  test("a connection can map another team with the stored key, and the key never comes back", async () => {
    await renderDialog(CONNECTED);
    expect(screen.getByTestId("linear-connected").textContent).toContain("Engineering");

    fireEvent.click(screen.getByTestId("linear-change-scope"));
    await screen.findByTestId("linear-scopes");
    const picked = screen
      .getAllByTestId("linear-scope-option")
      .find((option) => option.querySelector("input")?.checked);
    expect(picked?.dataset.scope).toBe("team:t1");
    fireEvent.click(
      screen.getAllByTestId("linear-scope-option")[1]?.querySelector("input") as HTMLElement,
    );
    fireEvent.click(screen.getByTestId("linear-save"));

    expect((await screen.findByTestId("linear-scope")).textContent).toBe("Operations");
    expect(api?.writes()).toEqual([
      { method: "POST", path: "/projects/p1/linear/catalog", body: {} },
      {
        method: "PUT",
        path: "/projects/p1/linear",
        body: { scope: { kind: "team", id: "t2", name: "Operations" } },
      },
    ]);
  });

  test("disconnecting asks once more, then removes the key", async () => {
    const view = await renderDialog(CONNECTED);

    fireEvent.click(screen.getByTestId("linear-disconnect"));
    expect(screen.getByTestId("linear-disconnect-confirm").textContent).toContain("Delete the key");
    expect(api?.writes()).toEqual([]);
    fireEvent.click(screen.getByTestId("linear-disconnect-confirmed"));

    await screen.findByTestId("linear-api-key");
    expect(api?.writes()).toEqual([
      { method: "DELETE", path: "/projects/p1/linear", body: undefined },
    ]);
    expect(view.changes()).toBe(1);
  });

  test("Replace key goes back to the key step, and Back returns", async () => {
    await renderDialog(CONNECTED);
    fireEvent.click(screen.getByTestId("linear-replace-key"));
    expect(screen.getByTestId("linear-api-key")).toBeTruthy();
    fireEvent.click(screen.getByTestId("linear-key-back"));
    expect(screen.getByTestId("linear-connected")).toBeTruthy();
  });

  test("a paired device sees what is connected but cannot change it", async () => {
    await renderDialog(CONNECTED, { owner: false });
    expect(screen.getByTestId("linear-connected")).toBeTruthy();
    expect(screen.queryByTestId("linear-disconnect")).toBeNull();
  });

  test("a paired device is told that only the host owner can connect Linear", async () => {
    await renderDialog(NONE, { owner: false });
    expect(screen.getByTestId("linear-owner-only").textContent).toContain("Only the host owner");
    expect(screen.queryByTestId("linear-api-key")).toBeNull();
  });
});
