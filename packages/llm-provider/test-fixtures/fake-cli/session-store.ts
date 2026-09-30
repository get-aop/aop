import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What one launch passed on its command line. */
export interface Launch {
  /** The `--append-system-prompt` text, if any. */
  appended: string | undefined;
  /** False with `--system-prompt-snapshot off`, which never records and never reuses a record. */
  recording: boolean;
  /** Every flag the launch passed, in order. Their values are not kept except the two below. */
  flags?: string[];
  /** The `--model` value; undefined when the launch passed none. */
  model?: string;
  /** The `--effort` value; undefined when the launch passed none. */
  effort?: string;
}

/** What a launch left in its session's file, so a test or a person can read the flags back. */
export interface RecordedLaunch {
  turn: number;
  flags: string[];
  /** Null when the launch passed no `--model`: Claude Code picked its own default. */
  model: string | null;
  /** Null when the launch passed no `--effort`. */
  effort: string | null;
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
  /** One entry per launch, in order. */
  launches: RecordedLaunch[];
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
  launch: Launch = { appended: undefined, recording: true },
): SessionTurn | null => {
  const id = resumeId ?? randomUUID();
  if (!SAFE_ID.test(id)) return null;

  const dir = join(home, "sessions", dialect);
  const file = join(dir, `${id}.json`);
  const known = existsSync(file);
  if (resumeId && !known) return null;

  mkdirSync(dir, { recursive: true });
  const stored: StoredSession = known ? readSession(file) : { turns: 0, launches: [] };
  const turn = stored.turns + 1;
  const { appended, recorded } = settleSystemPrompt(stored.systemPrompt, launch);
  const launches = [...stored.launches, recordedLaunch(turn, launch)];
  writeFileSync(file, JSON.stringify({ turns: turn, systemPrompt: recorded, launches }));
  return { id, turn, resumed: resumeId !== undefined, appendedSystemPrompt: appended };
};

/** The launches a session has had, oldest first; empty for a session this store never issued. */
export const readLaunches = (home: string, dialect: string, id: string): RecordedLaunch[] => {
  const file = join(home, "sessions", dialect, `${id}.json`);
  return SAFE_ID.test(id) && existsSync(file) ? readSession(file).launches : [];
};

const recordedLaunch = (turn: number, launch: Launch): RecordedLaunch => ({
  turn,
  flags: launch.flags ?? [],
  model: launch.model ?? null,
  effort: launch.effort ?? null,
});

// Claude Code renders the system prompt on a conversation's first request and, by default, sends
// that record on every later request and resume, whatever a later launch passes (CLI reference,
// "System prompt flags in resumed conversations"). Compaction, which also re-renders it, is not
// imitated.
const settleSystemPrompt = (
  recorded: StoredSession["systemPrompt"],
  launch: Launch,
): { appended: string | undefined; recorded: StoredSession["systemPrompt"] } => {
  if (!launch.recording) return { appended: launch.appended, recorded };
  const kept = recorded ?? { appended: launch.appended ?? null };
  return { appended: kept.appended ?? undefined, recorded: kept };
};

const readSession = (file: string): StoredSession => {
  const stored = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSession>;
  return {
    turns: stored.turns ?? 0,
    systemPrompt: stored.systemPrompt,
    launches: stored.launches ?? [],
  };
};
