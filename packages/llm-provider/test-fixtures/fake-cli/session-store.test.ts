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

    expect(second).toEqual({ id: first?.id as string, turn: 2, resumed: true });
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
