import type { ArtifactKind } from "@aop/common";
import {
  BracesIcon,
  CodeXmlIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  type LucideIcon,
  ScrollTextIcon,
  TableIcon,
  WorkflowIcon,
} from "lucide-react";

/** How a kind reads on a card and in the view's header. */
export const KIND_META: Record<ArtifactKind, { label: string; icon: LucideIcon }> = {
  markdown: { label: "Document", icon: FileTextIcon },
  json: { label: "JSON", icon: BracesIcon },
  code: { label: "Code", icon: CodeXmlIcon },
  csv: { label: "Table", icon: TableIcon },
  mermaid: { label: "Diagram", icon: WorkflowIcon },
  html: { label: "Web page", icon: GlobeIcon },
  svg: { label: "SVG", icon: ImageIcon },
  image: { label: "Image", icon: ImageIcon },
  pdf: { label: "PDF", icon: ScrollTextIcon },
  text: { label: "Text", icon: FileTextIcon },
};
