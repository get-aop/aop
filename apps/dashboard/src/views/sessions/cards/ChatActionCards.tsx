import type { ChatActionPayload } from "@aop/common";
import type { CSSProperties } from "react";

interface ChatActionCardsProps {
  action: ChatActionPayload;
  onOpenSession: (sessionId: string) => void;
}

/**
 * The card under an assistant message. A `session` action opens that session;
 * every other action type degrades to its label text.
 */
export const ChatActionCards = ({ action, onOpenSession }: ChatActionCardsProps) => {
  const sessionId = action.type === "session" ? action.id : undefined;
  if (sessionId) {
    return (
      <button type="button" onClick={() => onOpenSession(sessionId)} style={SESSION_BUTTON}>
        <strong>{action.label}</strong>
        <span>
          {action.sub} · {action.meta}
        </span>
      </button>
    );
  }
  return <p style={META}>{fallbackText(action)}</p>;
};

const fallbackText = (action: ChatActionPayload): string =>
  [action.label, action.sub, action.meta].filter(Boolean).join(" · ");

const META: CSSProperties = {
  marginTop: 11,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-text-subtle)",
};
const SESSION_BUTTON: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  marginTop: 11,
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 12,
  padding: "11px 13px",
  cursor: "pointer",
  textAlign: "left",
  color: "var(--color-text)",
};
