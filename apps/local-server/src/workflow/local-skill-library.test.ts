import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { loadLocalSkillBlocks, resolveLocalSkillRoots } from "./local-skill-library.ts";

describe("local skill library", () => {
  let localSkillRoot: string | null = null;

  afterEach(() => {
    if (localSkillRoot) {
      rmSync(localSkillRoot, { recursive: true, force: true });
      localSkillRoot = null;
    }
  });

  test("loads SKILL.md folders as workflow step blocks", async () => {
    localSkillRoot = createLocalSkillRoot({
      "code-review": `---
name: code-review
description: Review implementation changes for code quality and test gaps.
---

# Code Review
`,
    });

    const blocks = await loadLocalSkillBlocks([localSkillRoot]);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: "local_code_review",
        source: "local",
        type: "review",
        category: "general",
        description: "Review implementation changes for code quality and test gaps.",
        promptTemplate: expect.stringContaining("Follow the local `code-review` skill"),
        defaults: { maxAttempts: 3 },
      }),
    ]);
    expect(blocks[0]?.promptTemplate).toContain(join(localSkillRoot, "code-review", "SKILL.md"));
  });

  test("keeps duplicate local skill names addressable", async () => {
    localSkillRoot = createLocalSkillRoot({
      "first-review": `---
name: repeated-review
description: First review skill.
---`,
      "second-review": `---
name: repeated-review
description: Second review skill.
---`,
    });

    const blocks = await loadLocalSkillBlocks([localSkillRoot]);

    expect(blocks.map((block) => block.id)).toEqual([
      "local_repeated_review",
      "local_repeated_review_2",
    ]);
  });

  test("uses configured roots when AOP_WORKFLOW_SKILL_ROOTS is set", () => {
    const roots = resolveLocalSkillRoots({
      AOP_WORKFLOW_SKILL_ROOTS: ["/tmp/aop-skills-one", "/tmp/aop-skills-two"].join(delimiter),
    });

    expect(roots).toEqual(["/tmp/aop-skills-one", "/tmp/aop-skills-two"]);
  });
});

const createLocalSkillRoot = (skills: Record<string, string>): string => {
  const root = join(tmpdir(), `aop-local-skill-library-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });

  for (const [directory, markdown] of Object.entries(skills)) {
    const skillDir = join(root, directory);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), markdown);
  }

  return root;
};
