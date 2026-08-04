const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_MIN_STEP_MS = 450;
const SPINNER_INTERVAL_MS = 160;
const CLEAR_LINE = "\r\x1b[2K";

type StepOptions = {
  verbose?: boolean;
};

export type TerminalProgress = {
  banner: (message: string) => void;
  runStep: <T>(label: string, action: () => Promise<T>, options?: StepOptions) => Promise<T>;
};

type SpinnerHandle = {
  succeed: (label: string) => void;
  fail: (label: string) => void;
};

type TerminalProgressOptions = {
  enabled?: boolean;
  minStepMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  write?: (chunk: string) => void;
};

type StepRuntime = {
  minStepMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  write: (chunk: string) => void;
};

const formatElapsed = (startedAt: number, now: () => number): string => {
  const seconds = Math.max(0, Math.floor((now() - startedAt) / 1000));
  return `${seconds}s`;
};

const createSpinner = (
  label: string,
  startedAt: number,
  write: (chunk: string) => void,
  now: () => number,
): SpinnerHandle => {
  let frame = 0;
  const interval = setInterval(() => {
    const icon = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    write(`${CLEAR_LINE}${icon} ${label} (${formatElapsed(startedAt, now)})`);
    frame += 1;
  }, SPINNER_INTERVAL_MS);

  const finish = (icon: string, finalLabel: string) => {
    clearInterval(interval);
    write(`${CLEAR_LINE}${icon} ${finalLabel} (${formatElapsed(startedAt, now)})\n`);
  };

  return {
    succeed: (finalLabel) => finish("✓", finalLabel || label),
    fail: (finalLabel) => finish("✗", finalLabel || label),
  };
};

const waitForMinStepDuration = async (
  startedAt: number,
  runtime: Pick<StepRuntime, "minStepMs" | "now" | "sleep">,
): Promise<void> => {
  const remaining = runtime.minStepMs - (runtime.now() - startedAt);
  if (remaining > 0) {
    await runtime.sleep(remaining);
  }
};

const runVerboseStep = async <T>(
  label: string,
  action: () => Promise<T>,
  startedAt: number,
  runtime: StepRuntime,
): Promise<T> => {
  runtime.write(`\n▸ ${label}\n`);
  try {
    const result = await action();
    await waitForMinStepDuration(startedAt, runtime);
    runtime.write(`✓ ${label} (${formatElapsed(startedAt, runtime.now)})\n`);
    return result;
  } catch (error) {
    await waitForMinStepDuration(startedAt, runtime);
    runtime.write(`✗ ${label} (${formatElapsed(startedAt, runtime.now)})\n`);
    throw error;
  }
};

const runSpinnerStep = async <T>(
  label: string,
  action: () => Promise<T>,
  startedAt: number,
  runtime: StepRuntime,
): Promise<T> => {
  const spinner = createSpinner(label, startedAt, runtime.write, runtime.now);
  try {
    const result = await action();
    await waitForMinStepDuration(startedAt, runtime);
    spinner.succeed(label);
    return result;
  } catch (error) {
    await waitForMinStepDuration(startedAt, runtime);
    spinner.fail(label);
    throw error;
  }
};

export const createTerminalProgress = (options: TerminalProgressOptions = {}): TerminalProgress => {
  const write = options.write ?? ((chunk: string) => process.stdout.write(chunk));
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const minStepMs = options.minStepMs ?? DEFAULT_MIN_STEP_MS;
  const enabled =
    options.enabled ??
    (process.stdout.isTTY === true && process.env.CI !== "true" && process.env.TERM !== "dumb");
  const runtime: StepRuntime = { minStepMs, now, sleep, write };

  let activeSteps = 0;

  return {
    banner: (message: string) => {
      if (!enabled) {
        return;
      }
      write(`\n${message}\n`);
    },
    runStep: async (label, action, stepOptions) => {
      if (!enabled) {
        return action();
      }

      const nested = activeSteps > 0;
      activeSteps += 1;

      try {
        if (nested) {
          return await action();
        }

        const startedAt = now();
        if (stepOptions?.verbose) {
          return await runVerboseStep(label, action, startedAt, runtime);
        }

        return await runSpinnerStep(label, action, startedAt, runtime);
      } finally {
        activeSteps -= 1;
      }
    },
  };
};

export const silentTerminalProgress = createTerminalProgress({ enabled: false });
