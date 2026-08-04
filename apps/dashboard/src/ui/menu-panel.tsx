import { CheckIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface MenuListItem {
  id: string;
  label: string;
  sub?: string | null;
  icon?: ReactNode;
  dot?: string;
  check?: boolean;
  disabled?: boolean;
  dimmed?: boolean;
  destructive?: boolean;
  mono?: boolean;
  separatorBefore?: boolean;
  /** Non-interactive group eyebrow. */
  header?: boolean;
  onSelect: () => void;
  /** Internal section-header identity (legacy); action ids remain opaque strings. */
  sectionId?: string;
}

/** Legacy collapsible-group shape — no current consumer; kept for type compat. */
export interface MenuSection {
  id: string;
  label: string;
  defaultExpanded?: boolean;
  items: MenuListItem[];
}

interface MenuPanelProps {
  open: boolean;
  anchor: DOMRect | null;
  title?: string;
  items: MenuListItem[];
  onClose: () => void;
  onDismiss?: () => void;
  minWidth?: number;
  align?: "start" | "end";
  appearance?: "default" | "composer";
}

/**
 * THE anchored menu (PLAN §5.4). A thin adapter over ui/dropdown-menu: Radix
 * owns portal, positioning (anchored to an invisible 1×1 element at the
 * requested rect), keyboard nav, and dismissal. Esc keeps the app's
 * breadcrumb semantics (onClose = back) — the one keyboard bit that survives.
 */
export const MenuPanel = ({
  open,
  anchor,
  title,
  items,
  onClose,
  onDismiss = onClose,
  minWidth = 200,
  align = "start",
}: MenuPanelProps) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, open]);

  if (!open || !anchor) return null;

  return (
    <DropdownMenu open={open} onOpenChange={(next) => (next ? undefined : onDismiss())}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed z-[-1] size-px opacity-0"
          style={{ left: anchor.left, top: anchor.top }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align={align === "end" ? "end" : "start"}
        sideOffset={4}
        aria-label={title}
        className="max-h-[min(340px,calc(100vh-1rem))] overflow-y-auto p-1"
        style={{ minWidth }}
      >
        {title ? (
          <DropdownMenuLabel className="px-2.5 pb-2.5 pt-2 text-[11px] text-text-subtle">
            {title}
          </DropdownMenuLabel>
        ) : null}
        {items.map((item) => (
          <MenuPanelRow key={item.id} item={item} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const readAnchorRect = (event: { currentTarget: EventTarget | null }): DOMRect | null =>
  event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;

const MenuPanelRow = ({ item }: { item: MenuListItem }) => {
  if (item.header) {
    return (
      <DropdownMenuLabel className="select-none px-2.5 pb-1 pt-2.5 text-[11px] text-text-subtle">
        {item.label}
      </DropdownMenuLabel>
    );
  }
  return (
    <>
      {item.separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        disabled={item.disabled}
        aria-current={item.check ? "true" : undefined}
        variant={item.destructive ? "destructive" : "default"}
        onSelect={(event) => {
          // Consumers own the menu state (submenu breadcrumbs etc.).
          event.preventDefault();
          item.onSelect();
        }}
        className={cn("gap-2", item.dimmed && "opacity-50", item.mono && "font-mono")}
      >
        {item.dot ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: item.dot }}
          />
        ) : null}
        {item.icon}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.sub ? (
          <span className="ml-auto shrink-0 truncate font-mono text-[12px] text-text-subtle">
            {item.sub}
          </span>
        ) : null}
        {item.check ? (
          <CheckIcon className="size-3.5 shrink-0 text-running" strokeWidth={1.7} />
        ) : null}
      </DropdownMenuItem>
    </>
  );
};
