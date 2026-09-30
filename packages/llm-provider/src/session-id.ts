// Session ids are parsed out of agent-authored JSONL logs and later replayed
// as CLI arguments (codex receives one as a bare positional). An agent driven
// by malicious repo/ticket content can print arbitrary JSON, so ids must be
// shaped like ids — in particular they must not start with "-" (flag
// injection) or contain path separators.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const AOP_RECORD_ID_PATTERN = /^(?:crun|isess)_/;

export const sanitizeSessionId = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return SESSION_ID_PATTERN.test(trimmed) && !AOP_RECORD_ID_PATTERN.test(trimmed)
    ? trimmed
    : undefined;
};
