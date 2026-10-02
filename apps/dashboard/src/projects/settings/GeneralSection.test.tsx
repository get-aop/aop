import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Project } from "@aop/common";
import { toast } from "sonner";
import type { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, screen, waitFor, within } = await import("@testing-library/react");
const { GeneralSection } = await import("./GeneralSection");
const { renderSection, savePhase, type } = await import("./section-test-utils");
const { TYPING_DELAY_MS } = await import("./use-settings-autosave");

let api: ReturnType<typeof mockApi> | undefined;

const project = makeProject({
  id: "p1",
  name: "Checkout",
  goal: "Keep checkout fast",
  instructions: "Never touch payments.",
});

const renderGeneral = async (
  current: Project = project,
  respond?: Parameters<typeof renderSection>[2],
) => {
  const rendered = await renderSection(GeneralSection, current, respond);
  api = rendered.api;
  return rendered;
};

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

beforeEach(() => {
  window.history.pushState({}, "", "/projects/p1/settings");
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe("General shows the project", () => {
  test("with its name, goal and instructions, and sends nothing until something changes", async () => {
    await renderGeneral();
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Checkout");
    expect((screen.getByTestId("settings-goal") as HTMLTextAreaElement).value).toBe(
      "Keep checkout fast",
    );
    expect((screen.getByTestId("settings-instructions") as HTMLTextAreaElement).value).toBe(
      "Never touch payments.",
    );
    expect(screen.queryByTestId("settings-save")).toBeNull();
    await pause(TYPING_DELAY_MS + 50);
    expect(api?.writes()).toEqual([]);
  });

  test("the goal and the instructions count their characters against the limit", async () => {
    await renderGeneral();
    expect(screen.getByTestId("settings-goal-count").textContent).toBe("18 / 8,000");
    expect(screen.getByTestId("settings-instructions-count").textContent).toBe("21 / 16,000");
    type("settings-goal", "x".repeat(1234));
    expect(screen.getByTestId("settings-goal-count").textContent).toBe("1,234 / 8,000");
    type("settings-instructions", "x".repeat(14_500));
    expect(screen.getByTestId("settings-instructions-count").getAttribute("data-near-limit")).toBe(
      "true",
    );
  });
});

describe("typing saves by itself", () => {
  test("once typing pauses, in one request with only what changed", async () => {
    const { stub } = await renderGeneral();
    type("settings-goal", "Keep checkout fast and safe");
    type("settings-instructions", "Never touch payments.\nAsk before migrations.");
    expect(api?.writes()).toEqual([]);

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]).toEqual({
      method: "PATCH",
      path: "/projects/p1",
      body: {
        goal: "Keep checkout fast and safe",
        instructions: "Never touch payments.\nAsk before migrations.",
      },
    });
    await waitFor(() => expect(stub.calls.adopted).toHaveLength(1));
    await waitFor(() => expect(savePhase("settings-goal")).toBe("saved"));
    expect(savePhase("settings-instructions")).toBe("saved");
  });

  test("leaving the field saves at once, without waiting for the pause", async () => {
    await renderGeneral();
    type("settings-goal", "Ship it");
    fireEvent.blur(screen.getByTestId("settings-goal"));

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ goal: "Ship it" });
  });

  test("closing the section with typing in progress still sends it", async () => {
    const { leave } = await renderGeneral();
    type("settings-instructions", "Ask before migrations.");
    leave();

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ instructions: "Ask before migrations." });
    await pause(TYPING_DELAY_MS + 50);
    expect(api?.writes()).toHaveLength(1);
  });

  test("a name is sent trimmed, and keeps what was typed until the field is left", async () => {
    await renderGeneral();
    type("settings-name", "Checkout service ");

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ name: "Checkout service" });
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe(
      "Checkout service ",
    );
    await pause(TYPING_DELAY_MS + 50);
    expect(api?.writes()).toHaveLength(1);
  });

  test("changing a field back before the pause sends nothing", async () => {
    await renderGeneral();
    type("settings-name", "Other");
    type("settings-name", "Checkout");
    await pause(TYPING_DELAY_MS + 50);
    expect(api?.writes()).toEqual([]);
  });
});

describe("a name that cannot be saved", () => {
  test("a blank name says so and is never sent, not even on the way out", async () => {
    const { leave } = await renderGeneral();
    type("settings-name", "   ");
    expect(screen.getByTestId("settings-name-error").textContent).toBe("A project needs a name.");
    expect(screen.getByTestId("settings-name").getAttribute("aria-invalid")).toBe("true");
    await pause(TYPING_DELAY_MS + 50);
    leave();
    expect(api?.writes()).toEqual([]);
  });

  test("a name past the limit is refused in plain words, while other changes still save", async () => {
    await renderGeneral();
    type("settings-name", "x".repeat(101));
    type("settings-goal", "Ship it");

    expect(screen.getByTestId("settings-name-error").textContent).toBe(
      "Name can be at most 100 characters.",
    );
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ goal: "Ship it" });
  });

  test("the host's refusal shows on the row and the typed name stays", async () => {
    const { stub } = await renderGeneral(project, (call) =>
      call.method === "PATCH"
        ? Response.json({ error: "Project name already exists" }, { status: 409 })
        : undefined,
    );
    type("settings-name", "Taken");

    expect((await screen.findByTestId("settings-error")).textContent).toBe(
      "Project name already exists",
    );
    expect(savePhase("settings-name")).toBe("error");
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Taken");
    expect(stub.calls.adopted).toEqual([]);
  });
});

describe("a change the host refuses", () => {
  test("is held back, so it does not sink the next change", async () => {
    await renderGeneral(project, (call) =>
      call.method === "PATCH" && (call.body as { name?: string }).name !== undefined
        ? Response.json({ error: "Project name already exists" }, { status: 409 })
        : undefined,
    );
    type("settings-name", "Taken");
    await screen.findByTestId("settings-error");

    type("settings-goal", "Ship it");
    fireEvent.blur(screen.getByTestId("settings-goal"));
    await waitFor(() => expect(api?.writes()).toHaveLength(2));
    expect(api?.writes()[1]?.body).toEqual({ goal: "Ship it" });
    await waitFor(() => expect(savePhase("settings-goal")).toBe("saved"));
    expect(savePhase("settings-name")).toBe("error");
  });

  test("says so in a toast when the section has already closed", async () => {
    const failure = spyOn(toast, "error").mockImplementation(() => "");
    let answer: (response: Response) => void = () => {};
    const { leave } = await renderGeneral(project, (call) =>
      call.method === "PATCH"
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : undefined,
    );
    type("settings-goal", "Ship it");
    fireEvent.blur(screen.getByTestId("settings-goal"));
    await waitFor(() => expect(api?.writes()).toHaveLength(1));

    leave();
    // Already on its way: leaving does not send it again.
    expect(api?.writes()).toHaveLength(1);
    await act(async () => answer(Response.json({ error: "The host is busy" }, { status: 503 })));

    await waitFor(() => expect(failure).toHaveBeenCalledWith("Not saved: The host is busy"));
    failure.mockRestore();
  });
});

describe("icon and colour", () => {
  test("the tile beside the name picks an icon and a colour, each saved at once", async () => {
    const { rerender } = await renderGeneral();
    const tile = () => within(screen.getByTestId("settings-icon")).getByTestId("project-tile");
    expect([tile().textContent, tile().dataset.icon, tile().dataset.color]).toEqual([
      "C",
      "letter",
      "auto",
    ]);

    fireEvent.click(screen.getByTestId("settings-icon"));
    fireEvent.click(await screen.findByTestId("project-icon-option-book"));
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ icon: "book" });

    rerender({ ...project, icon: "book" });
    fireEvent.click(screen.getByTestId("project-color-option-orange"));
    await waitFor(() => expect(api?.writes()).toHaveLength(2));
    expect(api?.writes()[1]?.body).toEqual({ color: "orange" });
    rerender({ ...project, icon: "book", color: "orange" });
    expect([tile().dataset.icon, tile().dataset.color]).toEqual(["book", "orange"]);
  });

  test("Letter and Auto put back the fallback tile", async () => {
    await renderGeneral({ ...project, icon: "rocket", color: "teal" });
    fireEvent.click(screen.getByTestId("settings-icon"));
    fireEvent.click(await screen.findByTestId("project-icon-option-letter"));
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ icon: null });
  });
});

test("a setting that changes elsewhere shows up, and an edit in progress is kept", async () => {
  const { rerender } = await renderGeneral();
  type("settings-name", "Mine");

  rerender({ ...project, name: "Theirs", goal: "Changed elsewhere" });

  expect((screen.getByTestId("settings-goal") as HTMLTextAreaElement).value).toBe(
    "Changed elsewhere",
  );
  expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Mine");
});
