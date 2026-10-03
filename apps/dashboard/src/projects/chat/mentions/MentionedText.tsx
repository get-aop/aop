import { useOptionalChatContext } from "../chat-context";
import { ThreadChip } from "../ThreadChip";
import { messagePieces } from "./mention-markup";

/**
 * What the person wrote, as written, with each thread they @-mentioned drawn as the thread's chip,
 * which opens it. Outside a chat (nothing to look the thread up in) the mention is its title.
 */
export const MentionedText = ({ text }: { text: string }) => {
  const chat = useOptionalChatContext();
  if (!text.includes("](thread:")) return <>{text}</>;
  // Keyed by where each piece starts in the message, which is unique.
  let offset = 0;
  return (
    <>
      {messagePieces(text).map((piece) => {
        const at = offset;
        offset += piece.kind === "text" ? piece.text.length : piece.title.length + 1;
        if (piece.kind === "text") return piece.text;
        return chat ? <ThreadChip key={at} threadId={piece.threadId} /> : `@${piece.title}`;
      })}
    </>
  );
};
