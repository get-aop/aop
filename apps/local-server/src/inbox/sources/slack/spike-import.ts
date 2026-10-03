import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Slack Inbox design's first test left a working app's two tokens on the host, in
 * `~/.aop-slack-spike/tokens.env` (owner-only). Settings › Connections › Slack offers to import
 * them once, so the person need not paste them again; the folder, which also holds that test's
 * scripts and logs, is deleted once the tokens are saved.
 */
export const spikeDir = (): string => join(homedir(), ".aop-slack-spike");

export const readSpikeTokens = async (
  dir: string = spikeDir(),
): Promise<{ userToken: string; appToken: string } | null> => {
  let text: string;
  try {
    text = await readFile(join(dir, "tokens.env"), "utf8");
  } catch {
    return null;
  }
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const userToken = values.get("SLACK_USER_TOKEN");
  const appToken = values.get("SLACK_APP_TOKEN");
  return userToken && appToken ? { userToken, appToken } : null;
};

export const removeSpike = (dir: string = spikeDir()): Promise<void> =>
  rm(dir, { recursive: true, force: true });
