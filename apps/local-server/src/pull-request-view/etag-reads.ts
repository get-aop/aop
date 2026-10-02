import type { GithubService } from "../github/index.ts";
import type { GhRead } from "../github-cli/read.ts";

/** REST reads that ask GitHub "has this changed?" with the last ETag; a 304 costs no rate limit. */
export interface EtagReads {
  /** The body of `path`: GitHub's new answer, or the kept one when GitHub says it is unchanged. */
  get: (path: string) => Promise<GhRead<unknown>>;
}

const MAX_ENTRIES = 300;

export const createEtagReads = (github: Pick<GithubService, "restGet">): EtagReads => {
  const kept = new Map<string, { etag: string; body: unknown }>();

  const keep = (path: string, etag: string, body: unknown) => {
    kept.delete(path);
    kept.set(path, { etag, body });
    if (kept.size > MAX_ENTRIES) kept.delete(kept.keys().next().value as string);
  };

  return {
    get: async (path) => {
      const previous = kept.get(path);
      const read = await github.restGet(path, { etag: previous?.etag ?? null });
      if (!read.ok) return read;
      if (read.value.notModified) {
        // A 304 can only answer an ETag this map sent, so the kept body is there.
        return { ok: true, value: previous?.body ?? null };
      }
      if (read.value.etag) keep(path, read.value.etag, read.value.body);
      return { ok: true, value: read.value.body };
    },
  };
};
