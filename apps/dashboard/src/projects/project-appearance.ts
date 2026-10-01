import type { Project, ProjectColor, ProjectIcon } from "@aop/common";
import {
  BookIcon,
  BoxIcon,
  BugIcon,
  CodeIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  FolderIcon,
  GlobeIcon,
  type LucideIcon,
  RocketIcon,
  ShieldIcon,
  SparklesIcon,
  SquareTerminalIcon,
} from "lucide-react";

/** What a project's tile is drawn from: its id and name for the fallback, and what was picked. */
export type ProjectAppearance = Pick<Project, "id" | "name" | "icon" | "color">;

/** Each pickable icon's glyph and the name a screen reader says for it, in picker order. */
export const PROJECT_ICONS: Record<ProjectIcon, { glyph: LucideIcon; label: string }> = {
  box: { glyph: BoxIcon, label: "Box" },
  folder: { glyph: FolderIcon, label: "Folder" },
  code: { glyph: CodeIcon, label: "Code" },
  terminal: { glyph: SquareTerminalIcon, label: "Terminal" },
  rocket: { glyph: RocketIcon, label: "Rocket" },
  bug: { glyph: BugIcon, label: "Bug" },
  book: { glyph: BookIcon, label: "Book" },
  flask: { glyph: FlaskConicalIcon, label: "Flask" },
  globe: { glyph: GlobeIcon, label: "Globe" },
  database: { glyph: DatabaseIcon, label: "Database" },
  shield: { glyph: ShieldIcon, label: "Shield" },
  sparkles: { glyph: SparklesIcon, label: "Sparkles" },
};

// Eight muted hues, so neighbouring projects tell apart without any colour shouting. A project
// with no colour picked takes one from its id, so the same project looks the same everywhere.
export const PROJECT_COLORS: Record<ProjectColor, { hue: number; label: string }> = {
  blue: { hue: 212, label: "Blue" },
  green: { hue: 152, label: "Green" },
  orange: { hue: 32, label: "Orange" },
  purple: { hue: 282, label: "Purple" },
  pink: { hue: 348, label: "Pink" },
  teal: { hue: 178, label: "Teal" },
  yellow: { hue: 62, label: "Yellow" },
  indigo: { hue: 246, label: "Indigo" },
};

const HUES = Object.values(PROJECT_COLORS).map(({ hue }) => hue);

/** The hue a tile is drawn in: the picked colour's, else one taken from the id. */
export const tileHue = (project: Pick<Project, "id" | "color">): number =>
  project.color ? PROJECT_COLORS[project.color].hue : hueOfId(project.id);

/** The tile's background and glyph colours for a hue. */
export const tileColors = (hue: number) => ({
  background: `hsl(${hue} 32% 24%)`,
  color: `hsl(${hue} 62% 84%)`,
});

const hueOfId = (projectId: string): number => {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length] ?? 212;
};
