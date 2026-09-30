import type { MessageBlock } from "@aop/common";

// [Fix login](thread:isess_01abc): how a session writes a thread into its reply. The label is
// only there so the text still reads without chips; a client shows the thread's own title.
const THREAD_LINK = /\[[^\]\n]*\]\(thread:([A-Za-z0-9_-]+)\)/g;

/**
 * A reply's text as blocks: prose, and a thread chip wherever the text links to a thread.
 * Text with no such link is one text block, as it was written.
 */
export const textToBlocks = (text: string): MessageBlock[] => {
  const blocks: MessageBlock[] = [];
  let rest = 0;
  for (const link of text.matchAll(THREAD_LINK)) {
    pushText(blocks, text.slice(rest, link.index));
    blocks.push({ type: "thread-chip", threadId: link[1] as string });
    rest = link.index + link[0].length;
  }
  pushText(blocks, text.slice(rest));
  return blocks;
};

const pushText = (blocks: MessageBlock[], text: string): void => {
  if (text !== "") blocks.push({ type: "text", text });
};
