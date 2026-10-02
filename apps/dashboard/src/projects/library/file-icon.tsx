import type { LibraryFileKind } from "@aop/common";
import {
  FileCode2Icon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileTypeIcon,
  type LucideIcon,
  NotebookTextIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS: Record<LibraryFileKind, LucideIcon> = {
  image: FileImageIcon,
  pdf: FileTypeIcon,
  markdown: NotebookTextIcon,
  text: FileTextIcon,
  code: FileCode2Icon,
  other: FileIcon,
};

const TINTS: Record<LibraryFileKind, string> = {
  image: "text-merged",
  pdf: "text-blocked",
  markdown: "text-running",
  text: "text-text-muted",
  code: "text-ok",
  other: "text-text-subtle",
};

export const FileKindIcon = ({
  kind,
  className,
}: {
  kind: LibraryFileKind;
  className?: string;
}) => {
  const Icon = ICONS[kind];
  return <Icon aria-hidden="true" className={cn("shrink-0", TINTS[kind], className)} />;
};
