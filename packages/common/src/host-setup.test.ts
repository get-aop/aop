import { describe, expect, test } from "bun:test";
import { tailscaleServeCommand } from "./host-setup.ts";

describe("tailscaleServeCommand", () => {
  test("Stable takes 443; Nightly, or a host whose 443 is taken, keeps its own port", () => {
    expect(tailscaleServeCommand(25150, "stable")).toBe(
      "tailscale serve --bg --https=443 http://127.0.0.1:25150",
    );
    expect(tailscaleServeCommand(25650, "nightly")).toBe(
      "tailscale serve --bg --https=25650 http://127.0.0.1:25650",
    );
    expect(tailscaleServeCommand(25150, "stable", true)).toContain("--https=25150");
  });
});
