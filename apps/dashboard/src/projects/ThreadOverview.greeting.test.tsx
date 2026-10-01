import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Thread } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";
import { makeEntry, makeProject, makeThread } from "./test-utils";

setupDashboardDom();

const actualClientModule = await import("../api/client");
const getSettings = mock(async () => [
  { key: "chat_global_instructions", value: "" },
  { key: "display_name", value: "Marcelo Ribeiro Mendes" },
]);
mock.module("../api/client", () => ({ ...actualClientModule, getSettings }));

const { act, cleanup, render, screen } = await import("@testing-library/react");
const { ThreadOverview } = await import("./ThreadOverview");
const { useOverviewFilters } = await import("./layout/use-overview-filters");
const { noteSavedSettings } = await import("../settings/display-name");

const project = makeProject({ id: "p1" });

const Overview = ({ threads }: { threads: Thread[] }) => (
  <ThreadOverview entry={makeEntry(project, threads)} filters={useOverviewFilters()} />
);

const greeting = () => screen.getByTestId("overview-greeting").textContent;

afterEach(() => {
  cleanup();
  // The name is page-wide state; leave none behind for the next test.
  noteSavedSettings([{ key: "display_name", value: "" }]);
});

describe("the Overview greeting by name", () => {
  test("asks the host once for the name, greets by first name, and says welcome back once a thread finished", async () => {
    const { rerender } = render(<Overview threads={[makeThread({ status: "working" })]} />);
    expect(await screen.findByText("Welcome, Marcelo.")).toBeTruthy();

    rerender(
      <Overview
        threads={[makeThread({ status: "working" }), makeThread({ id: "t2", status: "resolved" })]}
      />,
    );
    expect(greeting()).toBe("Welcome back, Marcelo.");

    cleanup();
    render(<Overview threads={[]} />);
    expect(greeting()).toBe("Welcome, Marcelo.");
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  test("a name saved in Settings shows at once, and clearing it leaves a plain welcome back", () => {
    render(<Overview threads={[]} />);

    act(() => noteSavedSettings([{ key: "display_name", value: "Ada Lovelace" }]));
    expect(greeting()).toBe("Welcome, Ada.");

    act(() => noteSavedSettings([{ key: "display_name", value: "" }]));
    expect(greeting()).toBe("Welcome back.");
  });

  test("saving other settings leaves the name as it is", () => {
    render(<Overview threads={[]} />);
    act(() => noteSavedSettings([{ key: "display_name", value: "Ada" }]));

    act(() => noteSavedSettings([{ key: "max_concurrent_runs", value: "2" }]));
    expect(greeting()).toBe("Welcome, Ada.");
  });
});
