import type { StepAgent } from "../protocol/index.ts";

export const CREATE_TASK_IMAGE_LIMITS = {
  maxCount: 5,
  maxBytes: 5 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] as const,
} as const;

export const imageAttachmentMarker = (position: number): string => `#image${position}`;

export type CreateTaskImageMimeType = (typeof CREATE_TASK_IMAGE_LIMITS.allowedMimeTypes)[number];

export interface CreateTaskImageAttachment {
  id: string;
  mimeType: CreateTaskImageMimeType;
  /** Raw base64 payload (no data: URL prefix). */
  dataBase64: string;
}

export interface CreateTaskStartRequest {
  description: string;
  cwd: string;
  agent?: StepAgent;
}

export interface CreateTaskAnswerRequest {
  answer: string;
}

export interface CreateTaskFinalizeRequest {
  createChange: boolean;
}

/** @deprecated Legacy brainstorming flow — no longer returned by `/create-task/start`. */
export interface CreateTaskQuestionOption {
  label: string;
  description?: string;
}

/** @deprecated Legacy brainstorming flow — no longer returned by `/create-task/start`. */
export interface CreateTaskQuestion {
  question: string;
  header?: string;
  options?: CreateTaskQuestionOption[];
  multiSelect?: boolean;
}

/** @deprecated Legacy brainstorming flow — no longer returned by `/create-task/start`. */
export interface BrainstormingResult {
  title: string;
  description: string;
  requirements: string[];
  acceptanceCriteria: string[];
  executionChunks?: string[];
}

/** @deprecated Legacy brainstorming flow — no longer returned by `/create-task/start`. */
export type CreateTaskMode = "yolo" | "review";

/** @deprecated Legacy brainstorming flow — no longer returned by `/create-task/start`. */
export interface CreateTaskQuestionResponse {
  status: "question";
  sessionId: string;
  question: CreateTaskQuestion;
  questionCount: number;
  maxQuestions: number;
  assistantOutput?: string;
}

/** @deprecated Legacy brainstorming flow — no longer returned by `/create-task/start`. */
export interface CreateTaskCompletedResponse {
  status: "completed";
  sessionId: string;
  requirements: BrainstormingResult;
  assistantOutput?: string;
}

export interface CreateTaskStartSuccessResponse {
  status: "success";
  sessionId: string;
  changeName: string;
  taskPath: string;
  sourcePlanHash: string;
  logFilePath?: string;
}

export interface CreateTaskStartErrorResponse {
  status: "error";
  code: "invalid_state" | "internal";
  error: string;
  sessionId?: string;
}

export type CreateTaskStartResponse = CreateTaskStartSuccessResponse | CreateTaskStartErrorResponse;

/** @deprecated Use CreateTaskStartResponse */
export type CreateTaskStepResponse = CreateTaskStartResponse;

export interface CreateTaskFinalizeResponse {
  status: "success";
  sessionId: string;
  changeName?: string;
  warning?: string;
  draftPath?: string;
}

export interface CreateTaskCancelResponse {
  status: "success";
  sessionId: string;
}

// Leading filler that buries the real ask ("we need to add the ability to …").
// Longest phrases first; stripping is iterative so order is for efficiency only.
const TITLE_FILLER_PREFIXES = [
  "we need to add the ability to",
  "i need to add the ability to",
  "we need the ability to",
  "we need to be able to",
  "i need to be able to",
  "i want to be able to",
  "we want to be able to",
  "we should be able to",
  "add the ability to",
  "the ability to",
  "ability to",
  "it would be nice to",
  "would be nice to",
  "we would like to",
  "i would like to",
  "make sure to",
  "make sure we",
  "we need to",
  "i need to",
  "we want to",
  "i want to",
  "we should",
  "we have to",
  "we must",
  "we could",
  "can we",
  "could we",
  "can you",
  "please",
  "let's",
  "lets",
  "we need",
  "the",
  "an",
  "a",
];

const TITLE_TRAILING_STOPWORDS = new Set([
  "to",
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "for",
  "with",
  "and",
  "or",
  "that",
  "this",
  "into",
  "when",
  "we",
  "i",
  "it",
  "is",
  "are",
  "be",
]);

const TITLE_MAX_WORDS = 6;
const TITLE_MAX_CHARS = 60;

/** Length (incl. trailing space) of the filler prefix at `start`, or 0. */
const matchFillerPrefixLength = (lower: string, start: number): number => {
  for (const prefix of TITLE_FILLER_PREFIXES) {
    if (lower.startsWith(`${prefix} `, start)) {
      return prefix.length + 1;
    }
  }
  return 0;
};

const stripLeadingFiller = (line: string): string => {
  const lower = line.toLowerCase();
  let start = 0;
  for (let matched = matchFillerPrefixLength(lower, start); matched > 0; ) {
    start += matched;
    while (lower[start] === " ") start += 1;
    matched = matchFillerPrefixLength(lower, start);
  }
  return line.slice(start);
};

/** Keep only the first clause — split on punctuation or an alternative/aside. */
const firstClause = (text: string): string => {
  const boundary = text.search(/[,.;:]|\s+(?:or|so that|because|in order to)\s+/i);
  return boundary > 0 ? text.slice(0, boundary) : text;
};

const capTitleWords = (text: string): string => {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, TITLE_MAX_WORDS);
  while (
    words.length > 1 &&
    TITLE_TRAILING_STOPWORDS.has((words[words.length - 1] ?? "").toLowerCase())
  ) {
    words.pop();
  }
  return words.join(" ").slice(0, TITLE_MAX_CHARS).trim();
};

/**
 * Turn a free-text request into a short, action-led title for the task slug.
 * Drops leading filler, keeps the first clause (the primary ask, not the
 * rambling tail), and caps to a handful of words — so "we need to add the
 * ability to paste image clipboard or attach images…" → "Paste image clipboard".
 */
export const deriveTitleFromSourceText = (sourceText: string): string => {
  const firstLine = sourceText
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim();
  if (!firstLine) {
    return "New Task";
  }

  const title = capTitleWords(firstClause(stripLeadingFiller(firstLine)));
  if (!title) {
    return firstLine.slice(0, TITLE_MAX_CHARS).trim() || "New Task";
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
};
