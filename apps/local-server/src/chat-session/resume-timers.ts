// The longest delay setTimeout takes; a longer wait re-arms itself when this one runs out.
const MAX_TIMER_MS = 2 ** 31 - 1;
/** A timer that fires this early is treated as due: timers may run slightly ahead of the clock. */
const EARLY_TOLERANCE_MS = 50;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Runs `fire` at `at` (ISO-8601) unless the session's timer is armed again or cancelled first.
 * The timer is only the in-memory half of a wait: the time itself is stored on the session
 * (`chat_sessions.resumes_at`), and boot arms a timer for each one found there. It does not keep
 * the process alive.
 */
export const armResumeTimer = (
  sessionId: string,
  at: string,
  fire: () => Promise<unknown>,
): void => {
  cancelResumeTimer(sessionId);
  const wait = Date.parse(at) - Date.now();
  const timer = setTimeout(
    () => {
      timers.delete(sessionId);
      if (Date.parse(at) - Date.now() > EARLY_TOLERANCE_MS) {
        armResumeTimer(sessionId, at, fire);
        return;
      }
      void fire();
    },
    Math.min(Math.max(wait, 0), MAX_TIMER_MS),
  );
  timer.unref();
  timers.set(sessionId, timer);
};

export const cancelResumeTimer = (sessionId: string): void => {
  clearTimeout(timers.get(sessionId));
  timers.delete(sessionId);
};

export const cancelAllResumeTimers = (): void => {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
};
