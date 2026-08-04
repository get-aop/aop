import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface RunnerArgs {
  cwd?: string;
  logFile: string;
  model?: string;
  profile?: string;
  prompt: string;
  provider?: string;
  reasoningEffort?: string;
  resumeSessionId?: string;
}

const parseArgs = (argv: string[]): RunnerArgs => {
  let cwd: string | undefined;
  let logFile: string | undefined;
  let model: string | undefined;
  let profile: string | undefined;
  let prompt: string | undefined;
  let provider: string | undefined;
  let reasoningEffort: string | undefined;
  let resumeSessionId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || value === undefined) {
      continue;
    }

    switch (flag) {
      case "--cwd":
        cwd = value;
        index += 1;
        break;
      case "--log-file":
        logFile = value;
        index += 1;
        break;
      case "--model":
        model = value;
        index += 1;
        break;
      case "--profile":
        profile = value;
        index += 1;
        break;
      case "--prompt":
        prompt = value;
        index += 1;
        break;
      case "--provider":
        provider = value;
        index += 1;
        break;
      case "--reasoning-effort":
        reasoningEffort = value;
        index += 1;
        break;
      case "--resume-session-id":
        resumeSessionId = value;
        index += 1;
        break;
      default:
        break;
    }
  }

  if (!logFile) {
    throw new Error("Missing required --log-file argument");
  }

  if (!prompt) {
    throw new Error("Missing required --prompt argument");
  }

  return {
    cwd,
    logFile,
    model,
    profile,
    prompt,
    provider,
    reasoningEffort,
    resumeSessionId,
  };
};

const appendJsonl = (logFile: string, event: Record<string, unknown>): void => {
  appendFileSync(logFile, `${JSON.stringify(event)}\n`);
};

const appendAssistantLine = (logFile: string, message: string): void => {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }

  appendJsonl(logFile, {
    provider: "hermes",
    type: "assistant",
    message: trimmed,
  });
};

const flushDecodedLines = (buffer: string, onLine: (line: string) => void): string => {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    onLine(line);
  }

  return remainder;
};

const consumeStream = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
  onFlush: (line: string) => void,
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = flushDecodedLines(buffer, onLine);
  }

  if (buffer.trim()) {
    onFlush(buffer);
  }
};

const buildHermesCommand = (args: RunnerArgs): string[] => {
  const cmd = ["hermes"];

  if (args.profile) {
    cmd.push("-p", args.profile);
  }

  cmd.push("chat", "-Q", "--yolo", "-q", args.prompt);

  if (args.provider) {
    cmd.push("--provider", args.provider);
  }

  if (args.model) {
    cmd.push("--model", args.model);
  }

  if (args.resumeSessionId) {
    cmd.push("--resume", args.resumeSessionId);
  }

  return cmd;
};

const forwardSignal = (
  child: ReturnType<typeof Bun.spawn>,
  signal: NodeJS.Signals,
  logFile: string,
): void => {
  process.on(signal, () => {
    appendJsonl(logFile, {
      provider: "hermes",
      type: "result",
      subtype: "error",
      result: `Hermes runner received ${signal}`,
    });
    child.kill();
    process.exit(1);
  });
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(args.logFile), { recursive: true });

  if (args.reasoningEffort) {
    appendJsonl(args.logFile, {
      provider: "hermes",
      type: "system",
      message: `Hermes reasoning_effort remains profile-scoped; requested ${args.reasoningEffort}`,
    });
  }

  let stderrBuffer = "";
  let sessionId: string | undefined;

  const child = Bun.spawn({
    cmd: buildHermesCommand(args),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    cwd: args.cwd,
    env: process.env,
  });

  forwardSignal(child, "SIGINT", args.logFile);
  forwardSignal(child, "SIGTERM", args.logFile);

  await Promise.all([
    consumeStream(
      child.stdout,
      (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        const sessionIdMatch = trimmed.match(/^session_id:\s*(.+)$/);
        if (sessionIdMatch) {
          sessionId = sessionIdMatch[1]?.trim();
          return;
        }

        appendAssistantLine(args.logFile, trimmed);
      },
      (line) => appendAssistantLine(args.logFile, line),
    ),
    consumeStream(
      child.stderr,
      (line) => {
        stderrBuffer += `${line}\n`;
      },
      (line) => {
        stderrBuffer += line;
      },
    ),
  ]);

  const exitCode = await child.exited;
  if (exitCode === 0) {
    appendJsonl(args.logFile, {
      provider: "hermes",
      type: "result",
      subtype: "success",
      session_id: sessionId,
    });
    process.exit(0);
    return;
  }

  appendJsonl(args.logFile, {
    provider: "hermes",
    type: "result",
    subtype: "error",
    result: stderrBuffer.trim() || `Hermes exited with code ${exitCode}`,
    session_id: sessionId,
  });
  process.exit(exitCode);
};

void main();
