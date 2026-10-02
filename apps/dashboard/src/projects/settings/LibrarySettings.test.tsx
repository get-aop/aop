import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LibrarySettings } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeListing } from "../library/test-utils";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { UsageSection } = await import("./UsageSection");
const { choose, renderSection } = await import("./section-test-utils");

const project = makeProject({ id: "p1", name: "Checkout" });
let settings: LibrarySettings;

beforeEach(() => {
  window.localStorage.clear();
  settings = { retentionDays: null, capMb: null };
});

afterEach(() => cleanup());

const render = () =>
  renderSection(UsageSection, project, (call) => {
    if (call.path === "/projects/p1/library" && call.method === "GET") {
      return Response.json(makeListing([], { settings }));
    }
    if (call.path === "/projects/p1/library/settings" && call.method === "PUT") {
      settings = call.body as LibrarySettings;
      return Response.json(
        makeListing([], {
          settings,
          retention: { retentionDays: settings.retentionDays ?? 30, capMb: settings.capMb ?? 1024 },
        }),
      );
    }
    if (call.path.startsWith("/usage")) return Response.json({ error: "none" }, { status: 404 });
    return undefined;
  });

describe("the project's Library storage settings", () => {
  test("show the host's defaults until the project picks its own, and save each choice at once", async () => {
    const { api } = await render();

    await screen.findByTestId("settings-library");
    expect(screen.getByTestId("settings-library-retention").textContent).toBe(
      "Host default (30 days)",
    );
    expect(screen.getByTestId("settings-library-cap").textContent).toBe("Host default (1 GB)");

    await choose("settings-library-retention", "7 days");
    await waitFor(() =>
      expect(api.writes().map((call) => call.body)).toEqual([{ retentionDays: 7, capMb: null }]),
    );
    await choose("settings-library-cap", "No cap");
    await waitFor(() => expect(settings).toEqual({ retentionDays: 7, capMb: 0 }));
    await waitFor(() =>
      expect(screen.getByTestId("settings-library-cap").textContent).toBe("No cap"),
    );

    await choose("settings-library-retention", /Host default/);
    await waitFor(() => expect(settings).toEqual({ retentionDays: null, capMb: 0 }));
  });
});
