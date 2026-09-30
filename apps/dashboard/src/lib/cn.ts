import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The project screen's type scale (see `--text-*` in index.css). Declared here so merging treats
// `text-body` as a font size and does not drop it next to a text colour such as `text-text-muted`.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["body", "title", "meta", "greeting"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
