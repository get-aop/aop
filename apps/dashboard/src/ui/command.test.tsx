import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";

setupDashboardDom();
const { cleanup, render, screen, fireEvent } = await import("@testing-library/react");
afterEach(cleanup);

describe("Command filtering", () => {
  test("filters items by the input query", () => {
    render(
      <Command>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandItem value="implement">Implement</CommandItem>
          <CommandItem value="code-review">Code review</CommandItem>
          <CommandItem value="browser-check">Browser check</CommandItem>
        </CommandList>
      </Command>,
    );

    expect(screen.getByText("Implement")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "browser" } });

    expect(screen.getByText("Browser check")).toBeTruthy();
    expect(screen.queryByText("Implement")).toBeNull();
    expect(screen.queryByText("Code review")).toBeNull();
  });
});
