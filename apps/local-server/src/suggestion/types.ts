import type { ThreadError } from "../thread/types.ts";

export type SuggestionError =
  | ThreadError
  /** No such suggestion in this project's coordinator chat. */
  | { code: "SUGGESTION_NOT_FOUND" };

export type SuggestionResult<T> =
  | ({ success: true } & T)
  | { success: false; error: SuggestionError };
