export interface MarkdownFileContent {
  path: string;
  content: string;
  exists: boolean;
}

export const MARKDOWN_FILE_LIMITS = { maxBytes: 1_048_576 } as const;
