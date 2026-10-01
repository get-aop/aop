import type { MessageBlock, ThreadCardVariant } from "@aop/common";
import { memo, type ReactNode, useMemo } from "react";
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
import { ThinkingSection, ToolRun } from "./TurnParts";
import { useThreadPresence } from "./thread-presence";

/**
 * The content of an assistant message: its blocks in reading order, each drawn as what it is.
 * Prose and the chips inside it flow as one paragraph; tool calls made one after another fold
 * together, and reasoning folds on its own; the receipt leads; cards, proposals and quotes
 * stand on their own. The thread behind a card or chip is looked up when it is drawn. While the
 * reply is being written (`writing`), its last group is what the agent is doing now.
 */
export const MessageBlocks = memo(function MessageBlocks({
  messageId,
  blocks,
  writing = false,
  watched = false,
  renderSteer,
}: {
  /** The message the blocks belong to: what a proposal in them is answered against. */
  messageId: string;
  blocks: readonly MessageBlock[];
  writing?: boolean;
  /** The reply was on screen while it was being written: its prose renders in streaming mode. */
  watched?: boolean;
  /** Draws the message a `steer` block names, where the turn took it in. */
  renderSteer?: (messageId: string) => ReactNode;
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
          key={groupKey(group)}
          group={group}
          carded={carded}
          messageId={messageId}
          active={writing && index === groups.length - 1}
          watched={watched}
          renderSteer={renderSteer}
        />
      ))}
    </div>
  );
});

// A reply's blocks are only added to, so where a group starts names it while the reply grows.
const groupKey = (group: BlockGroup): string =>
  `${group.at}:${group.kind === "block" ? group.block.type : group.kind}`;

const GroupView = ({
  group,
  carded,
  messageId,
  active,
  watched,
  renderSteer,
}: {
  group: BlockGroup;
  carded: ReadonlySet<string>;
  messageId: string;
  active: boolean;
  watched: boolean;
  renderSteer?: (messageId: string) => ReactNode;
}) => {
  if (group.kind === "prose") return <Prose run={group.run} watched={watched} animating={active} />;
  if (group.kind === "tools") return <ToolRun tools={group.tools} active={active} />;
  const { block } = group;
  switch (block.type) {
    case "thinking":
      return <ThinkingSection text={block.text} active={active} />;
    case "routing-receipt":
      return <RoutingReceipt threadIds={block.threadIds} carded={carded} />;
    case "thread-card":
      return (
        <ThreadCardBlock messageId={messageId} threadId={block.threadId} variant={block.variant} />
      );
    case "suggested-threads":
      return <SuggestedThreads messageId={messageId} suggestions={block.suggestions} />;
    case "quote-forwarded":
      return <QuoteForwarded text={block.text} />;
    case "steer":
      return renderSteer?.(block.messageId) ?? null;
  }
};

// A thread has one card in the conversation, the newest; where an earlier message had one, a chip
// keeps the mention and the link, and shows the thread as it is now.
const ThreadCardBlock = ({
  messageId,
  threadId,
  variant,
}: {
  messageId: string;
  threadId: string;
  variant: ThreadCardVariant;
}) => {
  const owner = useThreadPresence().cardMessage.get(threadId);
  if (owner === undefined || owner === messageId) {
    return <ChatThreadCard threadId={threadId} variant={variant} />;
  }
  return (
    <p data-testid="chat-thread-card-earlier" data-thread-id={threadId} className="my-1 text-meta">
      <ThreadChip threadId={threadId} />
    </p>
  );
};

const Prose = ({
  run,
  watched,
  animating,
}: {
  run: readonly InlineBlock[];
  watched: boolean;
  animating: boolean;
}) => {
  const { markdown, chips } = useMemo(() => proseOf(run), [run]);
  const rendered = useMemo(() => chips.map(renderChip), [chips]);
  return (
    <ChatMarkdown
      content={markdown}
      chips={rendered}
      mode={watched ? "streaming" : "static"}
      animating={animating}
    />
  );
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
