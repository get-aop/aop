#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release CLI reports progress to the operator

import { compareReleaseVersions, isReleaseVersion } from "@aop/common";

/** Where the release workflow and local-publish write the notes, and deploy-r2.sh reads them. */
export const RELEASE_NOTES_PATH = "dist/release-notes.md";

/**
 * The newest published release older than `tag`. Release tags sit on thread-branch commits that
 * main squash-merges, so the previous tag is never an ancestor of the new one and GitHub's own
 * guess falls back to an older release; the notes have to be generated against this one.
 */
export const previousReleaseTag = (publishedTags: string[], tag: string): string | null => {
  const older = publishedTags
    .filter((candidate) => isReleaseVersion(candidate) && /^v/.test(candidate))
    .filter((candidate) => compareReleaseVersions(candidate, tag) < 0)
    .sort(compareReleaseVersions);
  return older.at(-1) ?? null;
};

/** The `gh api` call that generates the notes for `tag` since `previous`. */
export const generateNotesArgs = (repo: string, tag: string, previous: string | null): string[] => [
  "api",
  `repos/${repo}/releases/generate-notes`,
  "-f",
  `tag_name=${tag}`,
  ...(previous ? ["-f", `previous_tag_name=${previous}`] : []),
  "--jq",
  ".body",
];

const gh = async (args: string[]): Promise<string> => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "inherit" });
  const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed (exit ${exitCode})`);
  return out;
};

const main = async (): Promise<void> => {
  const [tag, repo, out = RELEASE_NOTES_PATH] = process.argv.slice(2);
  if (!tag || !repo) throw new Error("Usage: release-notes.ts <tag> <repo> [out]");
  const listed = await gh([
    "api",
    `repos/${repo}/releases`,
    "--paginate",
    "--jq",
    ".[] | select(.draft | not) | select(.prerelease | not) | .tag_name",
  ]);
  const previous = previousReleaseTag(listed.split("\n").filter(Boolean), tag);
  const notes = await gh(generateNotesArgs(repo, tag, previous));
  await Bun.write(out, notes);
  console.log(`Wrote the notes of ${tag} since ${previous ?? "the first release"} to ${out}`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
