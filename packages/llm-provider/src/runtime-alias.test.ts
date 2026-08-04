import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRuntimeAlias, resolveRuntimeExecutable } from "./runtime-alias";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveRuntimeAlias", () => {
  test("uses provider fallback bare name when value is empty", () => {
    expect(resolveRuntimeAlias(undefined, "claude")).toBe("claude");
    expect(resolveRuntimeAlias("  ", "codex")).toBe("codex");
  });

  test("keeps absolute paths as-is", () => {
    expect(resolveRuntimeAlias("/Users/me/.local/bin/cpe", "claude")).toBe(
      "/Users/me/.local/bin/cpe",
    );
  });

  test("resolves a configured bare name via PATH when present", () => {
    const dir = join(tmpdir(), `aop-runtime-alias-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    const bin = join(dir, "fake-cpe");
    writeFileSync(bin, "#!/bin/sh\nexit 0\n");
    chmodSync(bin, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${dir}${previousPath ? `:${previousPath}` : ""}`;
    try {
      expect(resolveRuntimeExecutable("fake-cpe")).toBe(bin);
      expect(resolveRuntimeAlias("fake-cpe", "claude")).toBe(bin);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test("returns bare name unchanged when not found", () => {
    expect(resolveRuntimeExecutable("definitely-missing-aop-runtime-xyz")).toBe(
      "definitely-missing-aop-runtime-xyz",
    );
  });
});
