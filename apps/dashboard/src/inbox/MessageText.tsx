import { cn } from "@/lib/cn";
import { splitLinks } from "./inbox-format";

/** A Slack message as the host rendered it: plain text, line breaks kept, links clickable. */
export const MessageText = ({ text, className }: { text: string; className?: string }) => (
  <p className={cn("break-words whitespace-pre-wrap", className)}>
    {splitLinks(text).map((part) =>
      part.url ? (
        <a
          key={part.start}
          href={part.text}
          target="_blank"
          rel="noreferrer noopener"
          className="text-running hover:underline"
        >
          {part.text}
        </a>
      ) : (
        <span key={part.start}>{part.text}</span>
      ),
    )}
  </p>
);
