import { mock } from "bun:test";
import type { DirectoryListing, GitFolderKind } from "@aop/common";

/** A folder in the fake host's tree: its subfolders, what they and it are to git. */
export interface FakeFolder {
  children?: Record<string, FakeFolder>;
  git?: GitFolderKind;
  worktreeOf?: string;
}

export interface FakeHost {
  /** The paths listed so far, as the dashboard asked for them. */
  listed: string[];
  /** The paths sent to POST /api/repos. */
  registered: string[];
}

/** Installs a fetch that answers /api/fs/directories from `tree` and records what is registered. */
export const installFakeHost = (tree: FakeFolder, home = "/home/me"): FakeHost => {
  const host: FakeHost = { listed: [], registered: [] };
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname.endsWith("/fs/directories")) {
      const requested = url.searchParams.get("path") ?? "";
      host.listed.push(requested);
      return Promise.resolve(listingResponse(tree, requested, home));
    }
    if (url.pathname.endsWith("/repos") && init?.method === "POST") {
      const { path } = JSON.parse(String(init.body)) as { path: string };
      host.registered.push(path);
      return Promise.resolve(json({ ok: true, repoId: "repo_1", alreadyExists: false }));
    }
    return Promise.resolve(json({}));
  }) as unknown as typeof globalThis.fetch;
  return host;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const listingResponse = (tree: FakeFolder, requested: string, home: string): Response => {
  const path = expandHome(requested, home);
  const folder = find(tree, path);
  if (!folder) return json({ error: "Path not found" }, 404);
  const children = folder.children ?? {};
  const directories = Object.keys(children).sort();
  const gitFolders: DirectoryListing["gitFolders"] = {};
  for (const name of directories) {
    const kind = children[name]?.git;
    if (kind) gitFolders[name] = kind;
  }
  const listing: DirectoryListing = {
    path,
    directories,
    parent: path === "/" ? null : path.slice(0, path.lastIndexOf("/")) || "/",
    gitFolders,
    gitKind: folder.git ?? null,
    worktreeOf: folder.worktreeOf ?? null,
  };
  return json(listing);
};

const find = (tree: FakeFolder, path: string): FakeFolder | null => {
  let folder = tree;
  for (const name of path.split("/").filter(Boolean)) {
    const next = folder.children?.[name];
    if (!next) return null;
    folder = next;
  }
  return folder;
};

const expandHome = (requested: string, home: string): string =>
  requested === "" ? home : requested.replace(/^~/, home);
