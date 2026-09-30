import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginTurn } from "./session-store";

const homes: string[] = [];
const newHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "aop-fake-cli-store-"));
  homes.push(home);
  return home;
};
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("beginTurn", () => {
  test("issues a fresh id for a new conversation", () => {
    const home = newHome();

    const first = beginTurn(home, "claude", undefined);
    const second = beginTurn(home, "claude", undefined);

    expect(first).toMatchObject({ turn: 1, resumed: false });
    expect(second?.id).not.toBe(first?.id);
  });

  test("counts each resume as another turn of the same session", () => {
    const home = newHome();
    const first = beginTurn(home, "claude", undefined);

    const second = beginTurn(home, "claude", first?.id);
    const third = beginTurn(home, "claude", first?.id);

    expect(second).toEqual({
      id: first?.id as string,
      turn: 2,
      resumed: true,
      appendedSystemPrompt: undefined,
    });
    expect(third?.turn).toBe(3);
  });

  test("refuses to resume an id it never issued, and ids from another dialect", () => {
    const home = newHome();
    const issued = beginTurn(home, "claude", undefined);

    expect(beginTurn(home, "claude", "never-issued")).toBeNull();
    expect(beginTurn(home, "codex", issued?.id)).toBeNull();
  });

  test("rejects ids that could escape the store directory", () => {
    expect(beginTurn(newHome(), "claude", "../../etc/passwd")).toBeNull();
  });
});

describe("beginTurn system prompt", () => {
  const launch = (appended: string | undefined, recording = true) => ({ appended, recording });

  test("a first turn uses what it passed", () => {
    const first = beginTurn(newHome(), "claude", undefined, launch("v1"));

    expect(first?.appendedSystemPrompt).toBe("v1");
  });

  test("a resume keeps the first turn's text, as Claude Code does by default, whatever it passes", () => {
    const home = newHome();
    const first = beginTurn(home, "claude", undefined, launch("v1"));

    const changed = beginTurn(home, "claude", first?.id, launch("v2"));
    const dropped = beginTurn(home, "claude", first?.id, launch(undefined));

    expect(changed?.appendedSystemPrompt).toBe("v1");
    expect(dropped?.appendedSystemPrompt).toBe("v1");
  });

  test("with the snapshot off every turn uses the text it passes, so an edit reaches a resume", () => {
    const home = newHome();
    const first = beginTurn(home, "claude", undefined, launch("v1", false));

    const second = beginTurn(home, "claude", first?.id, launch("v2", false));
    const third = beginTurn(home, "claude", first?.id, launch(undefined, false));

    expect(first?.appendedSystemPrompt).toBe("v1");
    expect(second?.appendedSystemPrompt).toBe("v2");
    expect(third?.appendedSystemPrompt).toBeUndefined();
  });

  test("turning the snapshot off keeps a recorded text out of the way without erasing it", () => {
    const home = newHome();
    const first = beginTurn(home, "claude", undefined, launch("v1"));

    const off = beginTurn(home, "claude", first?.id, launch("v2", false));
    const back = beginTurn(home, "claude", first?.id, launch("v3"));

    expect(off?.appendedSystemPrompt).toBe("v2");
    expect(back?.appendedSystemPrompt).toBe("v1");
  });

  test("a conversation that began with nothing appended stays that way while recording", () => {
    const home = newHome();
    const first = beginTurn(home, "claude", undefined, launch(undefined));

    expect(
      beginTurn(home, "claude", first?.id, launch("late"))?.appendedSystemPrompt,
    ).toBeUndefined();
  });
});
