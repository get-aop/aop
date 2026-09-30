import type { MessageBlock } from "@aop/common";
import { memo, useMemo } from "react";
import { PullRequestChip } from "../PullRequestChip";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatThreadCard } from "./ChatThreadCard";
import {
  type BlockGroup,
  type ChipBlock,
  groupBlocks,
  type InlineBlock,
  proseOf,
} from "./inline-run";
import { QuoteForwarded } from "./QuoteForwarded";
import { RoutingReceipt } from "./RoutingReceipt";
import { SuggestedThreads } from "./SuggestedThreads";
import { ThreadChip } from "./ThreadChip";

/**
 * The content of an assistant message: its blocks in reading order, each drawn as what it is.
 * Prose and the chips inside it flow as one paragraph; the receipt leads; cards, proposals and
 * quotes stand on their own. The thread behind a card or chip is looked up when it is drawn.
 */
export const MessageBlocks = memo(function MessageBlocks({
  messageId,
  blocks,
}: {
  /** The message the blocks belong to: what a proposal in them is answered against. */
  messageId: string;
  blocks: readonly MessageBlock[];
}) {
  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
  const carded = useMemo(
    () =>
      new Set(blocks.flatMap((block) => (block.type === "thread-card" ? [block.threadId] : []))),
    [blocks],
  );
  return (
    <div data-testid="message-blocks" className="flex min-w-0 flex-col">
      {groups.map((group, index) => (
        <GroupView
          key={groupKey(group, index)}
          group={group}
          carded={carded}
          messageId={messageId}
        />
      ))}
    </div>
  );
});

// A message's blocks never reorder, so a position is a stable identity for one of its groups.
const groupKey = (group: BlockGroup, index: number): string =>
  `${index}:${group.kind === "prose" ? "prose" : group.block.type}`;

const GroupView = ({
  group,
  carded,
  messageId,
}: {
  group: BlockGroup;
  carded: ReadonlySet<string>;
  messageId: string;
}) => {
  if (group.kind === "prose") return <Prose run={group.run} />;
  const { block } = group;
  switch (block.type) {
    case "routing-receipt":
      return <RoutingReceipt threadIds={block.threadIds} carded={carded} />;
    case "thread-card":
      return <ChatThreadCard threadId={block.threadId} variant={block.variant} />;
    case "suggested-threads":
      return <SuggestedThreads messageId={messageId} suggestions={block.suggestions} />;
    case "quote-forwarded":
      return <QuoteForwarded text={block.text} />;
  }
};

const Prose = ({ run }: { run: readonly InlineBlock[] }) => {
  const { markdown, chips } = useMemo(() => proseOf(run), [run]);
  const rendered = useMemo(() => chips.map(renderChip), [chips]);
  return <ChatMarkdown content={markdown} chips={rendered} />;
};

const renderChip = (chip: ChipBlock, index: number) =>
  chip.type === "thread-chip" ? (
    <ThreadChip key={index} threadId={chip.threadId} />
  ) : (
    <PullRequestChip
      key={index}
      pullRequest={{ number: chip.number, url: chip.url, state: chip.state }}
      className="mx-0.5"
    />
  );
