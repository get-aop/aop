import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearMethodologyCache,
  listMethodologySkillNames,
  loadMethodologySkill,
  resolveMethodologyPartial,
} from "./methodology-loader.ts";
import { loadTaskMethodology } from "./task-methodology.ts";

describe("methodology-loader", () => {
  const originalMethodologyDir = process.env.AOP_METHODOLOGY_DIR;

  beforeEach(() => {
    process.env.AOP_METHODOLOGY_DIR = originalMethodologyDir;
    clearMethodologyCache();
  });

  test("lists exactly the bundled methodology set", async () => {
    const names = await listMethodologySkillNames();
    expect(names).toEqual([
      "_artifact-reuse",
      "code-simplifier",
      "improve-codebase-architecture",
      "remove-ai-slop",
      "systematic-debugging",
      "test-driven-development",
    ]);
  });

  test("loads a restored methodology skill", async () => {
    const content = await loadMethodologySkill("test-driven-development");
    expect(content.length).toBeGreaterThan(0);
  });

  test("throws for retired Matt methodology names", async () => {
    await expect(loadMethodologySkill("grilling")).rejects.toThrow("Methodology skill not found");
    await expect(loadMethodologySkill("tdd")).rejects.toThrow("Methodology skill not found");
  });

  test("loadTaskMethodology renders the planning run", async () => {
    const methodology = await loadTaskMethodology();
    expect(methodology).toContain("# AOP Planning Run");
    expect(methodology).toContain("planMarkdown");
    expect(methodology).not.toContain("<aop-doc");
    expect(methodology).not.toContain("grilling");
    expect(methodology).not.toContain("issuesMarkdown");
    expect(methodology).not.toContain("prdMarkdown");
  });

  test("renders artifact reuse once before the goal section", async () => {
    const methodology = await loadTaskMethodology();
    const artifactReuseHeading = "# Artifact Reuse";

    expect(methodology.split(artifactReuseHeading)).toHaveLength(2);
    expect(methodology.indexOf(artifactReuseHeading)).toBeLessThan(methodology.indexOf("## Goal"));
  });

  test("resolves new methodology partial names", async () => {
    const skillNames = [
      "test-driven-development",
      "systematic-debugging",
      "code-simplifier",
      "remove-ai-slop",
      "improve-codebase-architecture",
      "_artifact-reuse",
    ];

    for (const skillName of skillNames) {
      const content = await resolveMethodologyPartial(`methodology:${skillName}`);
      expect(content).toContain("# ");
    }
  });

  test("loads skills from an installed methodology asset directory", async () => {
    const methodologyDir = await mkdtemp(join(tmpdir(), "aop-methodology-"));
    process.env.AOP_METHODOLOGY_DIR = methodologyDir;
    clearMethodologyCache();

    try {
      await writeFile(join(methodologyDir, "installed-skill.md"), "# Installed Skill");

      const content = await loadMethodologySkill("installed-skill");

      expect(content).toBe("# Installed Skill");
    } finally {
      await rm(methodologyDir, { force: true, recursive: true });
      process.env.AOP_METHODOLOGY_DIR = originalMethodologyDir;
      clearMethodologyCache();
    }
  });

  test("prefers installed methodology assets over bundled source files", async () => {
    const methodologyDir = await mkdtemp(join(tmpdir(), "aop-methodology-"));
    process.env.AOP_METHODOLOGY_DIR = methodologyDir;
    clearMethodologyCache();

    try {
      await writeFile(join(methodologyDir, "test-driven-development.md"), "# Installed TDD");

      const content = await loadMethodologySkill("test-driven-development");

      expect(content).toBe("# Installed TDD");
    } finally {
      await rm(methodologyDir, { force: true, recursive: true });
      process.env.AOP_METHODOLOGY_DIR = originalMethodologyDir;
      clearMethodologyCache();
    }
  });

  test("discovers methodology files from asset directories at runtime", async () => {
    const methodologyDir = await mkdtemp(join(tmpdir(), "aop-methodology-"));
    process.env.AOP_METHODOLOGY_DIR = methodologyDir;
    clearMethodologyCache();

    try {
      await writeFile(join(methodologyDir, "runtime-discovered.md"), "# Runtime Discovered");

      await expect(listMethodologySkillNames()).resolves.toContain("runtime-discovered");
    } finally {
      await rm(methodologyDir, { force: true, recursive: true });
      process.env.AOP_METHODOLOGY_DIR = originalMethodologyDir;
      clearMethodologyCache();
    }
  });
});
