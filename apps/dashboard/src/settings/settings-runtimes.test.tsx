import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { RuntimeUsage } from "@aop/common";
import { toast } from "sonner";
import { answerRuntimes, makeRuntime, makeStatus } from "../projects/runtime-test-utils";
import { type ApiCall, mockApi } from "../test/mock-api";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { render, screen, cleanup, fireEvent, waitFor, within } = await import(
  "@testing-library/react"
);
const { RuntimeConfigurationProvider } = await import("../hooks/runtime-configuration");
const { SettingsRuntimes } = await import("./settings-runtimes.tsx");

let api: ReturnType<typeof mockApi> | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
});

const RUNTIMES = {
  providers: [
    makeRuntime("claude-code", "Claude Code", [{ model: "claude-opus-5-5" }]),
    makeRuntime("rt_wrap", "Wrapper", [{ model: "glm-4.6" }]),
    makeRuntime("rt_gone", "Missing", [{ model: "m" }]),
  ],
  statuses: [
    { ...makeStatus("claude-code"), version: "2.1.288" },
    { ...makeStatus("rt_wrap"), auth: "unknown" as const, version: null },
    makeStatus("rt_gone", "The command `/opt/bin/rt_gone` was not found on this host's PATH."),
  ],
};

const renderPage = async (
  respond: (call: ApiCall) => Response | undefined = () => undefined,
  state: Parameters<typeof answerRuntimes>[0] = RUNTIMES,
) => {
  api = mockApi(
    (call) =>
      respond(call) ??
      answerRuntimes(state)(call) ??
      (call.path.startsWith("/agent-clis") ? Response.json({ clis: [] }) : undefined),
  );
  render(
    <RuntimeConfigurationProvider>
      <SettingsRuntimes />
    </RuntimeConfigurationProvider>,
  );
  await waitFor(() => expect(screen.getAllByTestId("runtime-row")).toHaveLength(3));
};

const row = (runtimeId: string) =>
  screen
    .getAllByTestId("runtime-row")
    .find((item) => item.dataset.runtimeId === runtimeId) as HTMLElement;

describe("SettingsRuntimes", () => {
  test("lists every runtime, built-in first, with what the host found for each", async () => {
    await renderPage();

    await waitFor(() => expect(within(row("rt_gone")).getByTestId("runtime-status")).toBeTruthy());
    expect(within(row("claude-code")).getByTestId("runtime-status").textContent).toContain(
      "Ready · Found · v2.1.288 · Logged in",
    );
    expect(within(row("rt_wrap")).getByTestId("runtime-status").textContent).toContain(
      "Ready · Found · Version unknown · Login unknown",
    );
    const missing = within(row("rt_gone")).getByTestId("runtime-status").textContent;
    expect(missing).toContain("Not ready · Not found");
    expect(missing).toContain("was not found on this host's PATH");
    expect(row("claude-code").textContent).toContain("Built-in");
    expect(within(row("claude-code")).getByTestId("runtime-default-badge")).toBeTruthy();
  });

  test("the default runtime is chosen from the ready runtimes and saved", async () => {
    let defaultRuntimeId = "claude-code";
    await renderPage((call) => {
      if (call.method !== "PUT" || call.path !== "/runtime-configuration/default") return undefined;
      defaultRuntimeId = (call.body as { runtimeId: string }).runtimeId;
      return Response.json({ defaultRuntimeId });
    });
    const trigger = screen.getByTestId("default-runtime-select");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    expect(
      (await screen.findByTestId("default-runtime-select-option-rt_gone")).getAttribute(
        "data-disabled",
      ) !== null,
    ).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: "Wrapper" }));

    await waitFor(() => expect(defaultRuntimeId).toBe("rt_wrap"));
  });

  test("removing a runtime projects use lists them and moves them to the default first", async () => {
    const usage: RuntimeUsage[] = [
      {
        projectId: "p1",
        projectName: "Checkout",
        roles: ["coordinator", "threads"],
        openThreads: 2,
      },
    ];
    const deleted: string[] = [];
    await renderPage((call) => {
      if (call.path === "/runtime-configuration/providers/rt_wrap/usage")
        return Response.json({ usage });
      if (call.method === "DELETE") {
        deleted.push(call.path);
        return new Response(null, { status: 204 });
      }
      return undefined;
    });

    fireEvent.pointerDown(within(row("rt_wrap")).getByLabelText("Actions for Wrapper"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    const list = await screen.findByTestId("remove-runtime-usage");

    expect(list.textContent).toContain("Checkout · coordinator, new threads, 2 open threads");
    const confirm = screen.getByTestId("remove-runtime-confirm");
    expect(confirm.textContent).toBe("Move them to Claude Code and remove");
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleted).toEqual(["/runtime-configuration/providers/rt_wrap?moveTo=default"]),
    );
  });

  test("the built-in runtime can be cloned but not edited or removed", async () => {
    await renderPage();

    fireEvent.pointerDown(within(row("claude-code")).getByLabelText("Actions for Claude Code"), {
      button: 0,
      ctrlKey: false,
    });

    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(items).toEqual(["Clone"]);
  });

  test("a runtime name past the limit is refused with a sentence naming the field", async () => {
    await renderPage();
    const failure = spyOn(toast, "error").mockImplementation(() => "");
    fireEvent.click(screen.getByText("Add custom runtime"));

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "n".repeat(61) } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "claude" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(failure).toHaveBeenCalledWith("Name can be at most 60 characters."));
    failure.mockRestore();
  });

  test("editing a runtime also applies its model list", async () => {
    const writes: string[] = [];
    await renderPage((call) => {
      if (call.method === "GET") return undefined;
      writes.push(`${call.method} ${call.path}`);
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ provider: RUNTIMES.providers[1], model: {} }, { status: 200 });
    });
    fireEvent.pointerDown(within(row("rt_wrap")).getByLabelText("Actions for Wrapper"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

    fireEvent.change(await screen.findByLabelText("Models"), { target: { value: "kimi-k2" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(writes).toEqual([
        "PATCH /runtime-configuration/providers/rt_wrap",
        "DELETE /runtime-configuration/models/rt_wrap_glm-4.6",
        "POST /runtime-configuration/providers/rt_wrap/models",
      ]),
    );
  });
});
