import { describe, expect, test } from "bun:test";
import type { ArtifactDetail } from "@aop/common";
import { downloadName, formatBytes } from "./file-actions";

const detail = (name: string, versioned = true): ArtifactDetail => ({
  id: "lib_1",
  title: "Plan",
  kind: "markdown",
  language: null,
  name,
  folder: "",
  currentVersion: 3,
  versions: [],
  versioned,
  originMessageId: null,
  originType: null,
  expiresAt: null,
});

describe("downloadName", () => {
  test("the Library's name for the current version, with the version for an older one", () => {
    expect(downloadName(detail("plan.md"), 3)).toBe("plan.md");
    expect(downloadName(detail("plan.md"), 1)).toBe("plan-v1.md");
    expect(downloadName(detail("Makefile"), 2)).toBe("Makefile-v2");
    expect(downloadName(detail("plan.md", false), 1)).toBe("plan.md");
  });

  test("sizes read as people write them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
