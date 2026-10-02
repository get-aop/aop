import type { PullRequestViewFile, PullRequestViewFilesResponse } from "@aop/common";
import { type GhRead, ghFailure } from "../github-cli/read.ts";
import type { EtagReads } from "./etag-reads.ts";

const PAGE_SIZE = 100;
/** GitHub lists at most 3000 files of a pull request. */
const MAX_PAGES = 30;

/**
 * The changed files with their patches, every page asked for at once, each conditional on its
 * last ETag. `changedFiles` (from the page's header) says how many pages there are.
 */
export const readPullRequestFiles = async (
  reads: EtagReads,
  nameWithOwner: string,
  number: number,
  changedFiles: number,
): Promise<GhRead<PullRequestViewFilesResponse>> => {
  const pages = Math.min(Math.max(1, Math.ceil(changedFiles / PAGE_SIZE)), MAX_PAGES);
  const pageReads = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      reads.get(
        `repos/${nameWithOwner}/pulls/${number}/files?per_page=${PAGE_SIZE}&page=${index + 1}`,
      ),
    ),
  );
  const files: PullRequestViewFile[] = [];
  for (const read of pageReads) {
    if (!read.ok) return read;
    // A page that is not a list is a broken answer; showing the rest would hide files silently.
    if (!Array.isArray(read.value))
      return ghFailure("GitHub sent a list of files AOP could not read");
    files.push(...read.value.map(fileOf));
  }
  return { ok: true, value: { files, truncated: changedFiles > files.length } };
};

interface RawFile {
  filename?: unknown;
  previous_filename?: unknown;
  status?: unknown;
  additions?: unknown;
  deletions?: unknown;
  patch?: unknown;
}

const STATUSES = new Set<PullRequestViewFile["status"]>([
  "added",
  "removed",
  "modified",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);

const fileOf = (raw: RawFile): PullRequestViewFile => ({
  path: String(raw.filename ?? ""),
  previousPath: typeof raw.previous_filename === "string" ? raw.previous_filename : null,
  status: STATUSES.has(raw.status as PullRequestViewFile["status"])
    ? (raw.status as PullRequestViewFile["status"])
    : "modified",
  additions: typeof raw.additions === "number" ? raw.additions : 0,
  deletions: typeof raw.deletions === "number" ? raw.deletions : 0,
  patch: typeof raw.patch === "string" ? raw.patch : null,
});
