import type { DirectoryListing } from "@aop/common";
import { useEffect, useRef, useState } from "react";
import { listDirectories } from "../../api/client";
import { joinPath, matchingFolders, splitTypedPath, typedFolder } from "./path-entry";

/**
 * The folder on show in the Attach repository dialog, and the path field that steers it. Typing
 * lists the folder the text names and narrows its subfolders to the name typed so far; a folder
 * that cannot be listed leaves the last good listing on screen with the reason beside it.
 */
export const useDirectoryBrowser = (active: boolean) => {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  // What `listing` was asked for, which can be `~` where the listing's own path is the home folder.
  const [listedFor, setListedFor] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const requestIdRef = useRef(0);

  const show = async (path: string | undefined, options: { keepDraft?: boolean } = {}) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const result = await listDirectories(path).catch((cause: unknown) => cause);
    if (requestId !== requestIdRef.current) return;
    setLoading(false);
    if (result instanceof Error) {
      setError(result.message);
      return;
    }
    if (!isDirectoryListing(result)) return;
    const next = result;
    setError(null);
    setListing(next);
    setListedFor(path ?? next.path);
    setHighlighted(-1);
    if (!options.keepDraft) setDraft(next.path);
  };
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    if (!active) return;
    requestIdRef.current += 1;
    setListing(null);
    setListedFor("");
    setDraft("");
    setError(null);
    setHighlighted(-1);
    void showRef.current(undefined);
  }, [active]);

  const currentPath = listing?.path ?? "";
  const typed = splitTypedPath(draft, currentPath);
  // A listing still on its way has not been asked about what was typed after it was requested.
  const fragment = listing && typed.dir === listedFor ? typed.fragment : "";
  const visible = matchingFolders(listing?.directories ?? [], fragment);

  // The field names the folder on show: no error beside it, and no half-typed folder name after it.
  const settled = !error && fragment === "";
  const attachable = settled && !loading && listing?.gitKind != null;

  const type = (value: string) => {
    setDraft(value);
    setHighlighted(-1);
    const next = splitTypedPath(value, currentPath);
    if (next.dir === listedFor) {
      // Back on the folder already on show: a listing still on its way is for a folder typed past.
      requestIdRef.current += 1;
      setLoading(false);
      setError(null);
      return;
    }
    void show(next.dir, { keepDraft: true });
  };

  const open = (name: string) => void show(joinPath(currentPath, name));

  const enter = () => {
    const name = visible[highlighted];
    if (name !== undefined) return open(name);
    void show(typedFolder(draft, currentPath));
  };

  /** Completes the highlighted folder, or the first one that matches; false when there is none. */
  const complete = (): boolean => {
    const name = visible[Math.max(highlighted, 0)];
    if (name === undefined || (highlighted < 0 && !fragment)) return false;
    const path = joinPath(currentPath, name);
    setDraft(`${path}/`);
    void show(path, { keepDraft: true });
    return true;
  };

  const move = (step: 1 | -1) =>
    setHighlighted((index) => Math.min(Math.max(index + step, 0), visible.length - 1));

  const resetDraft = () => {
    setDraft(currentPath);
    setError(null);
    setHighlighted(-1);
  };

  return {
    listing,
    draft,
    error,
    loading,
    visible,
    fragment,
    settled,
    attachable,
    highlighted,
    show,
    open,
    type,
    enter,
    complete,
    move,
    resetDraft,
  };
};

const isDirectoryListing = (value: unknown): value is DirectoryListing =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  "directories" in value &&
  "gitKind" in value;
