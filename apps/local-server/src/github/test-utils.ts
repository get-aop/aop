import type { CommandResult, RunCommand } from "../command-runner.ts";

export const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
export const fail = (stderr: string, exitCode = 1): CommandResult => ({
  exitCode,
  stdout: "",
  stderr,
});

/** A raw `gh api -i` answer: the status line, headers, a blank line, then the body. */
export const httpAnswer = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  const head = [
    `HTTP/2.0 ${status} ${status === 304 ? "Not Modified" : "OK"}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ].join("\r\n");
  const text = body === undefined ? "" : JSON.stringify(body);
  return { exitCode: status < 300 ? 0 : 1, stdout: `${head}\r\n\r\n${text}`, stderr: "" };
};

/**
 * A scripted command seam: `answer` decides each call from its args, and every call is kept,
 * so a test can count what reached GitHub.
 */
export const scriptedCommand = (answer: (args: string[], cwd: string) => CommandResult) => {
  const calls: string[][] = [];
  const run: RunCommand = async (args, cwd) => {
    calls.push(args);
    return answer(args, cwd);
  };
  return { run, calls };
};

/** A git seam whose `origin` points at `remotes[path]`, or has none. */
export const gitWithRemotes = (remotes: Record<string, string | undefined>) =>
  scriptedCommand((args, cwd) => {
    const url = remotes[cwd];
    if (args.join(" ") === "remote get-url origin") {
      return url ? ok(`${url}\n`) : fail("error: No such remote 'origin'", 2);
    }
    if (args.join(" ") === "remote -v") return ok(url ? `origin\t${url} (fetch)\n` : "");
    return fail(`unexpected git ${args.join(" ")}`);
  });
