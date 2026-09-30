import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What one launch passed for the system prompt. */
export interface SystemPromptLaunch {
  /** The `--append-system-prompt` text, if any. */
  appended: string | undefined;
  /** False with `--system-prompt-snapshot off`, which never records and never reuses a record. */
  recording: boolean;
}

export interface SessionTurn {
  id: string;
  /** 1 for a new conversation, then one more per resume (crashed and killed turns count). */
  turn: number;
  resumed: boolean;
  /** The appended system prompt the real CLI would have run this turn with. */
  appendedSystemPrompt: string | undefined;
}

interface StoredSession {
  turns: number;
  /** The first recorded launch's appended text (null: it appended nothing). */
  systemPrompt?: { appended: string | null };
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
  launch: SystemPromptLaunch = { appended: undefined, recording: true },
): SessionTurn | null => {
  const id = resumeId ?? randomUUID();
  if (!SAFE_ID.test(id)) return null;

  const dir = join(home, "sessions", dialect);
  const file = join(dir, `${id}.json`);
  const known = existsSync(file);
  if (resumeId && !known) return null;

  mkdirSync(dir, { recursive: true });
  const stored: StoredSession = known ? readSession(file) : { turns: 0 };
  const turn = stored.turns + 1;
  const { appended, recorded } = settleSystemPrompt(stored.systemPrompt, launch);
  writeFileSync(file, JSON.stringify({ turns: turn, systemPrompt: recorded }));
  return { id, turn, resumed: resumeId !== undefined, appendedSystemPrompt: appended };
};

// Claude Code renders the system prompt on a conversation's first request and, by default, sends
// that record on every later request and resume, whatever a later launch passes (CLI reference,
// "System prompt flags in resumed conversations"). Compaction, which also re-renders it, is not
// imitated.
const settleSystemPrompt = (
  recorded: StoredSession["systemPrompt"],
  launch: SystemPromptLaunch,
): { appended: string | undefined; recorded: StoredSession["systemPrompt"] } => {
  if (!launch.recording) return { appended: launch.appended, recorded };
  const kept = recorded ?? { appended: launch.appended ?? null };
  return { appended: kept.appended ?? undefined, recorded: kept };
};

const readSession = (file: string): StoredSession => {
  const stored = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSession>;
  return { turns: stored.turns ?? 0, systemPrompt: stored.systemPrompt };
};
