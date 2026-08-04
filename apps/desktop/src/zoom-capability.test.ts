import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Capability {
  $schema: string;
  description: string;
  identifier: string;
  local?: boolean;
  permissions: string[];
  remote?: { urls: string[] };
  windows?: string[];
}

const CAPABILITIES_DIR = join(import.meta.dir, "../src-tauri/capabilities");

describe("dashboard zoom capability", () => {
  test("allows only webview zoom from loopback dashboard origins", () => {
    const capability = readCapabilities().find(({ identifier }) => identifier === "dashboard-zoom");

    expect(capability).toEqual({
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "dashboard-zoom",
      description: "Allow the AOP dashboard served from loopback to control its webview zoom.",
      local: false,
      remote: { urls: ["http://127.0.0.1:*/*"] },
      windows: ["main"],
      permissions: ["core:webview:allow-set-webview-zoom"],
    });
  });
});

const readCapabilities = (): Capability[] =>
  readdirSync(CAPABILITIES_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) =>
      JSON.parse(readFileSync(join(CAPABILITIES_DIR, fileName), "utf8")),
    ) as Capability[];
