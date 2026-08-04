import { type RefObject, useState } from "react";
import type { TimelineMinimapItem } from "./chat-timeline-model";

export const ChatTimelineMinimap = ({
  items,
  visibleItemIds,
  scrollRef,
}: {
  items: TimelineMinimapItem[];
  visibleItemIds: ReadonlySet<string>;
  scrollRef: RefObject<HTMLDivElement | null>;
}) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (items.length < 2) return null;
  const activeItem = activeIndex === null ? null : items[activeIndex];
  const top = activeIndex === null ? 0 : (activeIndex / (items.length - 1)) * 100;

  const jumpTo = (item: TimelineMinimapItem) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${item.id}"]`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="group/minimap absolute left-3 top-1/2 z-10 hidden h-[min(45vh,320px)] -translate-y-1/2 md:block">
      <div className="relative h-full w-5">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-label="Jump to message: User message"
            title={item.userText}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
            onClick={() => jumpTo(item)}
            className={`absolute left-0 h-1 rounded-full transition-all hover:w-4 hover:bg-muted-foreground/60 focus-visible:w-4 focus-visible:bg-muted-foreground/60 focus-visible:outline-none ${
              visibleItemIds.has(item.id) ? "w-3 bg-foreground/55" : "w-2 bg-muted-foreground/25"
            }`}
            style={{ top: `${(index / (items.length - 1)) * 100}%` }}
          />
        ))}
        {activeItem ? (
          <div
            className="pointer-events-none absolute left-6 w-72 -translate-y-1/2 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl"
            style={{ top: `${top}%` }}
          >
            <p className="line-clamp-3 font-medium text-foreground">{activeItem.userText}</p>
            {activeItem.assistantText ? (
              <p className="mt-2 line-clamp-3 text-muted-foreground">{activeItem.assistantText}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};
