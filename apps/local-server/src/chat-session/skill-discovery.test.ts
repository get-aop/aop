import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverClaudeCodeSkills, discoverRuntimeSkills } from "./skill-discovery.ts";

describe("skill-discovery", () => {
  test("discovers skills with SKILL.md under repo .claude/skills", async () => {
    const repo = join(tmpdir(), `aop-skills-${crypto.randomUUID()}`);
    const skillDir = join(repo, ".claude", "skills", "commit");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: commit\ndescription: Commit helper\n---\n\nBody\n",
    );

    const names = await discoverClaudeCodeSkills(repo);
    expect(names).toContain("commit");
  });

  test("returns empty list for non-claude runtimes", async () => {
    expect(await discoverRuntimeSkills("codex-cli", "/tmp")).toEqual([]);
    expect(await discoverRuntimeSkills("grok-build", "/tmp")).toEqual([]);
  });

  test("discovers skills from the Claude config directory used by the runtime", async () => {
    const repo = join(tmpdir(), `aop-skills-config-${crypto.randomUUID()}`);
    const skillDir = join(repo, ".custom-claude", "skills", "review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: review\n---\n\nBody\n");

    const names = await discoverClaudeCodeSkills(repo, {
      CLAUDE_CONFIG_DIR: ".custom-claude",
    });

    expect(names).toContain("review");
  });

  test("skips directories without SKILL.md", async () => {
    const repo = join(tmpdir(), `aop-skills-empty-${crypto.randomUUID()}`);
    await mkdir(join(repo, ".claude", "skills", "nope"), { recursive: true });
    const names = await discoverClaudeCodeSkills(repo);
    expect(names).not.toContain("nope");
  });
});
