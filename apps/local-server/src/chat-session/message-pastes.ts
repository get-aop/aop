/** Compact chat pastes: display tokens + runtime expansion. */

export interface StoredChatPaste {
  index: number;
  lineCount: number;
  content: string;
}

const PASTE_CONTENT_MAX_CHARS = 500_000;
const PASTE_MAX_COUNT = 20;

export const expandStoredPastes = (
  text: string,
  pastes: ReadonlyArray<StoredChatPaste>,
): string => {
  if (pastes.length === 0 || !text.includes("[paste #")) return text;
  const byIndex = new Map(pastes.map((paste) => [paste.index, paste.content]));
  return text.replace(/\[paste #(\d+) \+\d+ lines?\]/g, (token, indexRaw: string) => {
    const body = byIndex.get(Number(indexRaw));
    return body ?? token;
  });
};

export const validateChatPastes = (
  pastes: unknown,
): { success: true; pastes: StoredChatPaste[] } | { success: false; error: string } => {
  if (pastes === undefined) return { success: true, pastes: [] };
  if (!Array.isArray(pastes)) return { success: false, error: "pastes must be an array" };
  if (pastes.length > PASTE_MAX_COUNT) {
    return { success: false, error: `At most ${PASTE_MAX_COUNT} pastes per message` };
  }
  const validated: StoredChatPaste[] = [];
  for (const [index, raw] of pastes.entries()) {
    const parsed = parseOnePaste(raw, index);
    if ("error" in parsed) return parsed;
    validated.push(parsed.paste);
  }
  return { success: true, pastes: validated };
};

const parseOnePaste = (
  raw: unknown,
  index: number,
): { paste: StoredChatPaste } | { success: false; error: string } => {
  if (!raw || typeof raw !== "object") {
    return { success: false, error: `paste ${index + 1} is invalid` };
  }
  const candidate = raw as Partial<StoredChatPaste>;
  const pasteIndex = Number(candidate.index);
  const lineCount = Number(candidate.lineCount);
  const content = typeof candidate.content === "string" ? candidate.content : "";
  if (!Number.isInteger(pasteIndex) || pasteIndex < 1) {
    return { success: false, error: `paste ${index + 1} index is invalid` };
  }
  if (!Number.isInteger(lineCount) || lineCount < 1) {
    return { success: false, error: `paste ${index + 1} lineCount is invalid` };
  }
  if (!content) return { success: false, error: `paste ${index + 1} content is required` };
  if (content.length > PASTE_CONTENT_MAX_CHARS) {
    return { success: false, error: `paste ${index + 1} exceeds size limit` };
  }
  return { paste: { index: pasteIndex, lineCount, content } };
};
