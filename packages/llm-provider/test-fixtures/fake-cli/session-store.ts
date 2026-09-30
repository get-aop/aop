import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SessionTurn {
  id: string;
  /** 1 for a new conversation, then one more per resume (crashed and killed turns count). */
  turn: number;
  resumed: boolean;
}

// Ids arrive on argv and become file names; reject anything that could leave `dir`.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * Records one more turn for a conversation. Resuming an id this store has never
 * issued returns null, the way the real CLIs refuse an unknown `--resume` id.
 * The turn is written before any output, so a killed or crashed turn still
 * leaves a session that can be resumed.
 */
export const beginTurn = (
  home: string,
  dialect: string,
  resumeId: string | undefined,
): SessionTurn | null => {
  const id = resumeId ?? randomUUID();
  if (!SAFE_ID.test(id)) return null;

  const dir = join(home, "sessions", dialect);
  const file = join(dir, `${id}.json`);
  const known = existsSync(file);
  if (resumeId && !known) return null;

  mkdirSync(dir, { recursive: true });
  const turn = known ? readTurnCount(file) + 1 : 1;
  writeFileSync(file, JSON.stringify({ turns: turn }));
  return { id, turn, resumed: resumeId !== undefined };
};

const readTurnCount = (file: string): number => {
  const stored = JSON.parse(readFileSync(file, "utf8")) as { turns?: number };
  return stored.turns ?? 0;
};
