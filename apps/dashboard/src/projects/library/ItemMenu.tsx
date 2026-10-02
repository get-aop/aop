import type { LibraryItem } from "@aop/common";
import {
  DownloadIcon,
  EyeIcon,
  FolderInputIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { IconButton } from "../../components/IconButton";

export type ItemAction =
  | "open"
  | "viewer"
  | "download"
  | "rename"
  | "move"
  | "pin"
  | "source"
  | "delete";

// What opens a dialog: the menu must not hand focus back to its button as the dialog takes it.
const OPENS_DIALOG: readonly ItemAction[] = ["open", "rename", "move", "delete"];

/** An item's actions behind its "…" button. */
export const ItemMenu = ({
  item,
  onAction,
  className,
}: {
  item: LibraryItem;
  onAction: (action: ItemAction, item: LibraryItem) => void;
  className?: string;
}) => {
  const chosen = useRef<ItemAction | null>(null);
  const choose = (action: ItemAction, chosenItem: LibraryItem) => {
    chosen.current = action;
    onAction(action, chosenItem);
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) chosen.current = null;
      }}
    >
      <DropdownMenuTrigger asChild>
        <IconButton
          testId="library-item-menu"
          label={`Actions for ${item.name}`}
          className={className}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        data-testid="library-item-menu-content"
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (chosen.current && OPENS_DIALOG.includes(chosen.current)) event.preventDefault();
        }}
      >
        <MenuItem action="open" item={item} onAction={choose} icon={<EyeIcon />} label="Preview" />
        <MenuItem
          action="viewer"
          item={item}
          onAction={choose}
          icon={<PanelLeftIcon />}
          label="Open beside the chat"
        />
        <MenuItem
          action="download"
          item={item}
          onAction={choose}
          icon={<DownloadIcon />}
          label="Download"
        />
        {item.usedIn ? (
          <MenuItem
            action="source"
            item={item}
            onAction={choose}
            icon={<MessageSquareIcon />}
            label={item.usedIn.messageId ? "Show message" : "Show chat"}
          />
        ) : null}
        <DropdownMenuSeparator />
        <MenuItem
          action="rename"
          item={item}
          onAction={choose}
          icon={<PencilIcon />}
          label="Rename"
        />
        <MenuItem
          action="move"
          item={item}
          onAction={choose}
          icon={<FolderInputIcon />}
          label="Move to folder"
        />
        <MenuItem
          action="pin"
          item={item}
          onAction={choose}
          icon={item.pinned ? <PinOffIcon /> : <PinIcon />}
          label={item.pinned ? "Unpin" : "Pin (keep forever)"}
        />
        <DropdownMenuSeparator />
        <MenuItem
          action="delete"
          item={item}
          onAction={choose}
          icon={<Trash2Icon />}
          label="Delete"
          destructive
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MenuItem = ({
  action,
  item,
  onAction,
  icon,
  label,
  destructive = false,
}: {
  action: ItemAction;
  item: LibraryItem;
  onAction: (action: ItemAction, item: LibraryItem) => void;
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
}) => (
  <DropdownMenuItem
    data-testid={`library-action-${action}`}
    variant={destructive ? "destructive" : "default"}
    onSelect={() => onAction(action, item)}
  >
    {icon}
    {label}
  </DropdownMenuItem>
);
