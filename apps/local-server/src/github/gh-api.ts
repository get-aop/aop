import type { z } from "zod";
import { attemptGh, type GhRead, ghFailure, readGhOutput } from "../github-cli/read.ts";
import type { RunGh } from "../github-cli/run-gh.ts";

/*
 * GitHub's two APIs through the host's authenticated `gh`: GraphQL for reads that need several
 * fields of many items in one call, REST for conditional reads (an unchanged answer, a 304, does
 * not count against the rate limit). Neither throws; a failure says why and whether GitHub is
 * throttling.
 */

export type GraphqlVariables = Record<string, string | number | boolean | readonly string[] | null>;

/** Runs a GraphQL query and checks its `data` against `schema`. */
export const graphqlQuery = async <T>(
  runGh: RunGh,
  cwd: string,
  query: string,
  variables: GraphqlVariables,
  schema: z.ZodType<T>,
): Promise<GhRead<T>> => {
  const output = await readGhOutput(
    runGh,
    ["api", "graphql", "-f", `query=${query}`, ...variableFlags(variables)],
    cwd,
  );
  if (!output.ok) return output;
  const body = parseJson(output.value) as { data?: unknown; errors?: { message?: string }[] };
  if (body?.errors?.length) {
    return ghFailure(body.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  }
  const parsed = schema.safeParse(body?.data);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : ghFailure("GitHub returned data AOP did not expect");
};

/** A REST read: the body and its ETag, or `notModified` when `etag` still names the answer. */
export type RestResponse =
  | { notModified: false; etag: string | null; body: unknown }
  | { notModified: true; etag: string };

/** `GET` of a REST path (`repos/o/r/pulls?...`), conditional on `etag` when one is given. */
export const restGet = async (
  runGh: RunGh,
  cwd: string,
  path: string,
  options: { etag?: string | null } = {},
): Promise<GhRead<RestResponse>> => {
  const args = ["api", "-i", path];
  if (options.etag) args.push("-H", `If-None-Match: ${options.etag}`);
  const run = await attemptGh(runGh, args, cwd);
  if (!run.ran) return ghFailure(run.message);
  const { result } = run;
  // `gh api` exits 1 on a 304 but still prints it, so the status line decides.
  const response = parseHttpResponse(result.stdout);
  if (!response) {
    return ghFailure(result.stderr.trim() || `gh exited with code ${result.exitCode}`);
  }
  return restRead(response, options.etag ?? null, result.stderr.trim());
};

const restRead = (
  response: { status: number; etag: string | null; body: string },
  sentEtag: string | null,
  stderr: string,
): GhRead<RestResponse> => {
  if (response.status === 304 && sentEtag) {
    return { ok: true, value: { notModified: true, etag: response.etag ?? sentEtag } };
  }
  if (response.status >= 200 && response.status < 300) {
    return {
      ok: true,
      value: { notModified: false, etag: response.etag, body: parseJson(response.body) },
    };
  }
  const message = (parseJson(response.body) as { message?: string } | null)?.message;
  return ghFailure(`HTTP ${response.status}: ${message ?? (stderr || "request failed")}`);
};

const variableFlags = (variables: GraphqlVariables): string[] =>
  Object.entries(variables).flatMap(([name, value]) => {
    if (value === null) return [];
    if (Array.isArray(value)) return value.flatMap((item) => ["-f", `${name}[]=${item}`]);
    // -F types numbers and booleans; -f keeps a string a string even when it looks like one.
    return typeof value === "string" ? ["-f", `${name}=${value}`] : ["-F", `${name}=${value}`];
  });

const parseHttpResponse = (
  text: string,
): { status: number; etag: string | null; body: string } | null => {
  const status = text.match(/^HTTP\/[\d.]+ (\d{3})/);
  if (!status) return null;
  const split = text.search(/\r?\n\r?\n/);
  const head = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? "" : text.slice(split).trimStart();
  const etag = head.match(/^etag:\s*(.+?)\s*$/im)?.[1] ?? null;
  return { status: Number(status[1]), etag, body };
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
