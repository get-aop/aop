/**
 * Text that marks commands and paths with backticks, as the host's messages and the docs do,
 * shown with those parts as code and without the backticks.
 */
export const WithCode = ({ text }: { text: string }) => (
  <>
    {segmentsOf(text).map(({ at, part, code }) =>
      code ? (
        <code key={at} className="rounded bg-canvas px-1 text-[11.5px] text-text">
          {part}
        </code>
      ) : (
        <span key={at}>{part}</span>
      ),
    )}
  </>
);

/** Splits on backticks; each part is keyed by where it starts in the text. */
const segmentsOf = (text: string): { at: number; part: string; code: boolean }[] => {
  let at = 0;
  return text.split("`").map((part, position) => {
    const segment = { at, part, code: position % 2 === 1 };
    at += part.length + 1;
    return segment;
  });
};
