import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Context } from "hono";
import type { LocalServerContext } from "../context.ts";
import { getRepoById } from "../repo/handlers.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";
import { getTaskById } from "./handlers.ts";

export type ReviewNote = {
  id: string;
  filePath: string;
  selectedText: string;
  textOccurrence?: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
};

type ReviewNoteInput = {
  filePath?: unknown;
  selectedText?: unknown;
  textOccurrence?: unknown;
  note?: unknown;
};

const REVIEW_NOTES_FILE = ".aop-review-notes.json";
const REVIEW_OUTPUT_FILE = "plan-review.md";

const listMdFiles = (dir: string, prefix = ""): string[] => {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...listMdFiles(join(dir, entry.name), relative));
      } else if (entry.name.endsWith(".md")) {
        files.push(relative);
      }
    }
    return files;
  } catch {
    return [];
  }
};

export const isValidMdPath = (filePath: string, changeDir: string): boolean => {
  if (filePath.includes("..") || !filePath.endsWith(".md")) {
    return false;
  }
  const resolved = resolve(changeDir, filePath);
  return resolved.startsWith(changeDir);
};

export const handleListFiles = async (ctx: LocalServerContext, c: Context) => {
  const repoId = c.req.param("repoId") as string;
  const taskId = c.req.param("taskId");
  if (!taskId) return c.json({ error: "Task ID is required" }, 400);

  const repo = await getRepoById(ctx, repoId);
  if (!repo) return c.json({ error: "Repo not found" }, 404);

  const task = await getTaskById(ctx, taskId);
  if (!task || task.repo_id !== repoId) return c.json({ error: "Task not found" }, 404);

  const changeDir = resolveTaskDir(task.repo_id, repo.path, task.change_path);
  const files = listMdFiles(changeDir);
  return c.json({ files });
};

const extractFilePath = (url: string): string => {
  const pathname = new URL(url).pathname;
  const marker = "/files/";
  const idx = pathname.indexOf(marker);
  return idx >= 0 ? decodeURIComponent(pathname.slice(idx + marker.length)) : "";
};

export const handleReadFile = async (ctx: LocalServerContext, c: Context) => {
  const repoId = c.req.param("repoId") as string;
  const taskId = c.req.param("taskId");
  if (!taskId) return c.json({ error: "Task ID is required" }, 400);
  const filePath = extractFilePath(c.req.url);

  const repo = await getRepoById(ctx, repoId);
  if (!repo) return c.json({ error: "Repo not found" }, 404);

  const task = await getTaskById(ctx, taskId);
  if (!task || task.repo_id !== repoId) return c.json({ error: "Task not found" }, 404);

  const changeDir = resolveTaskDir(task.repo_id, repo.path, task.change_path);
  if (!isValidMdPath(filePath, changeDir)) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  const fullPath = join(changeDir, filePath);
  try {
    const content = readFileSync(fullPath, "utf-8");
    return c.json({ content });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
};

export const handleListReviewNotes = async (ctx: LocalServerContext, c: Context) => {
  const resolved = await resolveTaskChangeDir(ctx, c);
  if (resolved.response) return resolved.response;

  return c.json({ notes: readReviewNotes(resolved.changeDir) });
};

export const handleCreateReviewNote = async (ctx: LocalServerContext, c: Context) => {
  const resolved = await resolveTaskChangeDir(ctx, c);
  if (resolved.response) return resolved.response;

  const body = await c.req.json<ReviewNoteInput>().catch(() => ({}));
  const input = parseReviewNoteInput(body, resolved.changeDir);
  if (!input.ok) return c.json({ error: input.error }, 400);

  const now = new Date().toISOString();
  const note: ReviewNote = {
    id: randomUUID(),
    filePath: input.filePath,
    selectedText: input.selectedText,
    ...(input.textOccurrence ? { textOccurrence: input.textOccurrence } : {}),
    note: input.note,
    createdAt: now,
    updatedAt: now,
  };
  const notes = [...readReviewNotes(resolved.changeDir), note];
  writeReviewNotes(resolved.changeDir, notes);

  return c.json({ note });
};

export const handleUpdateReviewNote = async (ctx: LocalServerContext, c: Context) => {
  const resolved = await resolveTaskChangeDir(ctx, c);
  if (resolved.response) return resolved.response;

  const noteId = c.req.param("noteId");
  const body = await c.req.json<Partial<ReviewNoteInput>>().catch(() => ({}));
  const notes = readReviewNotes(resolved.changeDir);
  const noteIndex = notes.findIndex((note) => note.id === noteId);
  if (noteIndex === -1) return c.json({ error: "Review note not found" }, 404);

  const nextNote = buildUpdatedReviewNote(notes[noteIndex] as ReviewNote, body, resolved.changeDir);
  if (!nextNote.ok) return c.json({ error: nextNote.error }, 400);

  notes[noteIndex] = nextNote.note;
  writeReviewNotes(resolved.changeDir, notes);

  return c.json({ note: nextNote.note });
};

export const handleDeleteReviewNote = async (ctx: LocalServerContext, c: Context) => {
  const resolved = await resolveTaskChangeDir(ctx, c);
  if (resolved.response) return resolved.response;

  const noteId = c.req.param("noteId");
  const notes = readReviewNotes(resolved.changeDir);
  const nextNotes = notes.filter((note) => note.id !== noteId);
  if (nextNotes.length === notes.length) return c.json({ error: "Review note not found" }, 404);

  writeReviewNotes(resolved.changeDir, nextNotes);
  return c.json({ ok: true });
};

export const handleSubmitReviewNotes = async (ctx: LocalServerContext, c: Context) => {
  const resolved = await resolveTaskChangeDir(ctx, c);
  if (resolved.response) return resolved.response;

  const submittedAt = new Date().toISOString();
  const notes = readReviewNotes(resolved.changeDir);
  const pendingNotes = notes.filter((note) => !note.submittedAt);
  if (pendingNotes.length === 0) {
    return c.json({ error: "No pending review notes" }, 409);
  }

  writeFileSync(
    join(resolved.changeDir, REVIEW_OUTPUT_FILE),
    buildReviewMarkdown({
      existingContent: readReviewMarkdown(resolved.changeDir),
      notes: pendingNotes,
      submittedAt,
    }),
    "utf-8",
  );
  writeReviewNotes(
    resolved.changeDir,
    notes.map((note) =>
      note.submittedAt ? note : { ...note, submittedAt, updatedAt: submittedAt },
    ),
  );

  return c.json({
    ok: true,
    filePath: REVIEW_OUTPUT_FILE,
    submittedCount: pendingNotes.length,
    regenerating: false,
  });
};

const resolveTaskChangeDir = async (ctx: LocalServerContext, c: Context) => {
  const repoId = c.req.param("repoId") as string;
  const taskId = c.req.param("taskId");
  if (!taskId) return { response: c.json({ error: "Task ID is required" }, 400) };

  const repo = await getRepoById(ctx, repoId);
  if (!repo) return { response: c.json({ error: "Repo not found" }, 404) };

  const task = await getTaskById(ctx, taskId);
  if (!task || task.repo_id !== repoId) {
    return { response: c.json({ error: "Task not found" }, 404) };
  }

  return {
    changeDir: resolveTaskDir(task.repo_id, repo.path, task.change_path),
    task,
    response: null,
  };
};

const parseReviewNoteInput = (
  body: ReviewNoteInput,
  changeDir: string,
):
  | { ok: true; filePath: string; selectedText: string; textOccurrence?: number; note: string }
  | { ok: false; error: string } => {
  const filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
  const selectedText = typeof body.selectedText === "string" ? body.selectedText.trim() : "";
  const textOccurrence = parseTextOccurrence(body.textOccurrence);
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!isValidMdPath(filePath, changeDir)) return { ok: false, error: "Invalid file path" };
  if (!selectedText) return { ok: false, error: "Missing required field: selectedText" };
  if (!note) return { ok: false, error: "Missing required field: note" };

  return {
    ok: true,
    filePath,
    selectedText,
    ...(textOccurrence ? { textOccurrence } : {}),
    note,
  };
};

const buildUpdatedReviewNote = (
  current: ReviewNote,
  body: Partial<ReviewNoteInput>,
  changeDir: string,
): { ok: true; note: ReviewNote } | { ok: false; error: string } => {
  const next = {
    ...current,
    filePath: typeof body.filePath === "string" ? body.filePath.trim() : current.filePath,
    selectedText:
      typeof body.selectedText === "string" ? body.selectedText.trim() : current.selectedText,
    textOccurrence:
      body.textOccurrence === undefined
        ? current.textOccurrence
        : parseTextOccurrence(body.textOccurrence),
    note: typeof body.note === "string" ? body.note.trim() : current.note,
    updatedAt: new Date().toISOString(),
  };

  const validation = parseReviewNoteInput(next, changeDir);
  if (!validation.ok) return validation;

  return { ok: true, note: next };
};

const readReviewNotes = (changeDir: string): ReviewNote[] => {
  try {
    const raw = readFileSync(join(changeDir, REVIEW_NOTES_FILE), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.flatMap(parseStoredReviewNote) : [];
  } catch {
    return [];
  }
};

const parseStoredReviewNote = (value: unknown): ReviewNote[] => {
  if (!value || typeof value !== "object") return [];
  const note = value as Partial<ReviewNote>;
  if (
    typeof note.id !== "string" ||
    typeof note.filePath !== "string" ||
    typeof note.selectedText !== "string" ||
    typeof note.note !== "string" ||
    typeof note.createdAt !== "string" ||
    typeof note.updatedAt !== "string"
  ) {
    return [];
  }

  const textOccurrence = parseTextOccurrence(note.textOccurrence);

  return [
    {
      id: note.id,
      filePath: note.filePath,
      selectedText: note.selectedText,
      ...(textOccurrence ? { textOccurrence } : {}),
      note: note.note,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      ...(typeof note.submittedAt === "string" ? { submittedAt: note.submittedAt } : {}),
    },
  ];
};

const parseTextOccurrence = (value: unknown): number | undefined => {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
};

const writeReviewNotes = (changeDir: string, notes: ReviewNote[]): void => {
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, REVIEW_NOTES_FILE), `${JSON.stringify(notes, null, 2)}\n`, "utf-8");
};

const readReviewMarkdown = (changeDir: string): string => {
  try {
    return readFileSync(join(changeDir, REVIEW_OUTPUT_FILE), "utf-8");
  } catch {
    return "";
  }
};

const buildReviewMarkdown = ({
  existingContent,
  notes,
  submittedAt,
}: {
  existingContent: string;
  notes: ReviewNote[];
  submittedAt: string;
}): string => {
  const lines = existingContent.trim()
    ? [existingContent.trim(), ""]
    : [
        "# Plan Review Corrections",
        "",
        "Use these reviewer notes to update the reviewed task plan.",
        "",
      ];

  lines.push(`## Review round ${submittedAt}`, "");

  for (const filePath of [...new Set(notes.map((note) => note.filePath))].sort()) {
    lines.push(`### ${filePath}`, "");
    for (const note of notes.filter((item) => item.filePath === filePath)) {
      lines.push(`> ${note.selectedText.replaceAll("\n", "\n> ")}`, "", note.note, "");
    }
  }

  return lines.join("\n");
};
