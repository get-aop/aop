import {
  closeSync,
  constants,
  existsSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import type { RawProviderEvent } from "../logs";

/**
 * A Claude Code run that takes more user messages while it works. The CLI reads stream-json
 * user lines on stdin (`--input-format stream-json`) and, between tool calls, hands the ones
 * that arrived to the model; a message that arrives while it writes its answer starts another
 * turn in the same process once that answer ends. With `--replay-user-messages` it echoes each
 * line it took, `isReplay: true` and the `uuid` it was sent with, where the model got it.
 *
 * The run must outlive the host, so its stdin is not a pipe the host holds. A named pipe (FIFO)
 * next to the run's log is the way in: the host opens it, writes one line and closes it, before
 * and after a restart alike. Claude Code never sees end of input on a FIFO, though, and would
 * wait for more after its last answer forever. So a small relay sits between them (`sh`): it
 * holds the FIFO open for writing itself, so writers come and go without ending the input,
 * copies it into a real pipe to the CLI with `cat`, and lets go of it on SIGUSR1. `cat` then
 * reads to the end, the CLI sees end of input, finishes the turn it is on and exits 0.
 *
 * The relay is the process the run records: its exit status is the CLI's, a stop signals its
 * process group, and its command line names the CLI. It also gives up the input by itself once
 * the log has been still for half an hour, so a run whose host never comes back still ends.
 * Ending the input never cuts a turn short: only a steer sent after that waits for the next turn.
 */
export interface InputChannel {
  /** The FIFO. The relay removes it when the run ends. */
  path: string;
  /** The stream-json `uuid` of the run's prompt, echoed back where the CLI took it. */
  promptUuid: string;
}

/** When a relay ends its run's input by itself: the log has been still this long, looked at this often. */
export interface RelayIdle {
  minutes: number;
  pollSeconds: number;
}

const RELAY_IDLE: RelayIdle = { minutes: 30, pollSeconds: 60 };

const RELAY_NAME = "aop-claude-input";

// $1 the FIFO, $2 the file with the prompt line, $3 the run's log, $4 the idle minutes, $5 how
// often to look, then the CLI's command. Traps come first: a SIGUSR1 before them would end it.
// The read end is opened before anything can let go of the write end (fd 3): opening a FIFO with
// no writer blocks. `wait` waits for the whole pipeline, and `cat` would read the FIFO for ever,
// so the CLI's end also lets go of the FIFO; its status goes through a file, as a `wait` a trap
// cut short loses it. A stop signals the process group: the CLI is a grandchild.
// Each pipeline stage closes the FIFO with `exec` inside its own subshell, not with a redirection
// on the group: dash (Debian and Ubuntu's /bin/sh) keeps a saved copy of a redirected fd open in
// the subshell, and that hidden write end meant `cat` never saw end of input on a Linux host.
const RELAY_SCRIPT = `fifo=$1 first=$2 log=$3 idle=$4 poll=$5
shift 5
trap 'exec 3>&-' USR1
trap 'trap - TERM INT HUP; kill -TERM 0' TERM INT HUP
exec 3<>"$fifo" 4<"$fifo" || exit 125
{ exec 3>&-; cat "$first"; rm -f "$first"; exec cat <&4 4<&-; } |
  { exec 3>&- 4<&-; "$@"; status=$?; echo "$status" >"$fifo.status"; kill -USR1 $$; exit "$status"; } &
pid=$!
exec 4<&-
( while sleep "$poll"; do
    if [ -n "$(find "$log" -mmin +"$idle" 2>/dev/null)" ]; then kill -USR1 $$; exit 0; fi
  done ) 3>&- </dev/null >/dev/null 2>&1 &
watchdog=$!
status=1
while kill -0 "$pid" 2>/dev/null; do wait "$pid"; status=$?; done
[ -s "$fifo.status" ] && status=$(cat "$fifo.status")
kill "$watchdog" 2>/dev/null
rm -f "$fifo" "$fifo.status"
exit "$status"`;

/** The relay's command line around the CLI's own. */
export const relayCommand = (
  channel: InputChannel,
  promptPath: string,
  logFilePath: string,
  cli: string[],
  idle: RelayIdle = RELAY_IDLE,
): string[] => [
  "/bin/sh",
  "-c",
  RELAY_SCRIPT,
  RELAY_NAME,
  channel.path,
  promptPath,
  logFilePath,
  String(idle.minutes),
  String(idle.pollSeconds),
  ...cli,
];

/**
 * Makes the FIFO (owner only) and writes the prompt line beside it, where the relay reads it
 * first and removes it. `remove` takes both away once the run is over: the relay removes them
 * itself, and one that never started or died early leaves them behind.
 */
export const openInputChannel = (
  channel: InputChannel,
  promptLine: string,
): { promptPath: string; remove: () => void } => {
  rmSync(channel.path, { force: true });
  const made = Bun.spawnSync(["mkfifo", "-m", "600", channel.path], { stderr: "pipe" });
  if (made.exitCode !== 0) {
    throw new Error(`claude-code: could not make the input FIFO: ${made.stderr.toString().trim()}`);
  }
  const promptPath = `${channel.path}.prompt`;
  writeFileSync(promptPath, promptLine, { mode: 0o600 });
  return {
    promptPath,
    remove: () => {
      rmSync(promptPath, { force: true });
      rmSync(channel.path, { force: true });
    },
  };
};

/** How long a write waits for the relay to start reading before it gives up. */
const WRITE_START_TIMEOUT_MS = 5_000;
const WRITE_RETRY_MS = 5;

/**
 * Writes one stream-json line into a run's input. False when nobody reads it any more: the run
 * ended, or its input was ended. A FIFO with no reader yet belongs to a relay still starting, and
 * is waited for. A line is only ever given up on before its first byte, so the input never holds
 * half a line.
 */
export const writeInputLine = async (path: string, line: string): Promise<boolean> => {
  const fd = await openForWriting(path, Date.now() + WRITE_START_TIMEOUT_MS);
  if (fd === null) return false;
  try {
    return await writeAll(fd, Buffer.from(line));
  } finally {
    closeSync(fd);
  }
};

/**
 * Ends a run's input: the relay lets go of its FIFO and the CLI exits once it has answered what
 * it took. False when the relay is gone.
 */
export const endInput = (relayPid: number): boolean => {
  try {
    process.kill(relayPid, "SIGUSR1");
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether a run has answered everything it was given: every steer it was sent (by `uuid`) was
 * taken, and a result came after the last of them. Its input can then end. A steer the CLI has
 * not taken yet is still on its way, so the run is not done, whatever results came before.
 */
export const isInputSettled = (
  events: readonly RawProviderEvent[],
  steerUuids: readonly string[],
): boolean => {
  const waiting = new Set(steerUuids);
  let lastTaken = -1;
  for (const [index, event] of events.entries()) {
    const uuid = replayedUuid(event);
    if (uuid && waiting.delete(uuid)) lastTaken = index;
  }
  if (waiting.size > 0) return false;
  return events.some((event, index) => index > lastTaken && event.type === "result");
};

/**
 * The `uuid` of a user line written to the CLI that it echoed back as taken, or null for any other
 * line. Claude Code 2.1.287 also echoes messages it adds itself, such as a background command's
 * `<task-notification>`; those carry an `origin` and were never written to it.
 */
export const replayedUuid = (event: RawProviderEvent): string | null =>
  event.type === "user" &&
  event.isReplay === true &&
  event.origin === undefined &&
  typeof event.uuid === "string"
    ? event.uuid
    : null;

const openForWriting = async (path: string, deadline: number): Promise<number | null> => {
  while (true) {
    const opened = tryOpen(path);
    if (opened !== "no-reader") return opened;
    if (Date.now() > deadline || !existsSync(path)) return null;
    await Bun.sleep(WRITE_RETRY_MS);
  }
};

// Non-blocking: with no reader the open fails at once (ENXIO) instead of waiting for one.
const tryOpen = (path: string): number | null | "no-reader" => {
  try {
    return openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    if (isErrno(error, "ENXIO")) return "no-reader";
    throw error;
  }
};

const writeAll = async (fd: number, bytes: Buffer): Promise<boolean> => {
  const startedAt = Date.now();
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSome(fd, bytes, offset);
    if (written === "closed") return false;
    if (written > 0) {
      offset += written;
      continue;
    }
    if (offset === 0 && Date.now() - startedAt > WRITE_START_TIMEOUT_MS) return false;
    await Bun.sleep(WRITE_RETRY_MS);
  }
  return true;
};

// Bytes written, 0 when the FIFO is full for now, or "closed" when its reader went away.
const writeSome = (fd: number, bytes: Buffer, offset: number): number | "closed" => {
  try {
    return writeSync(fd, bytes, offset);
  } catch (error) {
    if (isErrno(error, "EPIPE")) return "closed";
    if (isErrno(error, "EAGAIN")) return 0;
    throw error;
  }
};

const isErrno = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
