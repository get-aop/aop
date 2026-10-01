/**
 * Migration v15: the icon and colour a person picks for a project. Versions 1 to 14 are never
 * edited; a database that applied them only runs these statements.
 *
 * - projects.icon / projects.color: null until someone picks one, which keeps the letter tile on
 *   the id's own colour. No CHECK lists the values: the sets live in `ProjectIconSchema` and
 *   `ProjectColorSchema`, so adding an icon needs no migration.
 */
export const PROJECT_APPEARANCE_V15_STATEMENTS: readonly string[] = [
  `ALTER TABLE projects ADD COLUMN icon TEXT`,
  `ALTER TABLE projects ADD COLUMN color TEXT`,
];
