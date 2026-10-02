/** A JSON value's place in the document, as `$.items[3].name`; keys that are not identifiers are quoted. */
export type JsonPath = readonly (string | number)[];

export const formatJsonPath = (path: JsonPath): string =>
  path.reduce<string>((text, segment) => {
    if (typeof segment === "number") return `${text}[${segment}]`;
    return /^[A-Za-z_$][\w$]*$/.test(segment)
      ? `${text}.${segment}`
      : `${text}[${JSON.stringify(segment)}]`;
  }, "$");

export const pathKey = (path: JsonPath): string => JSON.stringify(path);

/**
 * The paths whose key or value contains `query` (case-insensitive), and every path above them, so
 * the tree can open down to each match. Empty for an empty query.
 */
export const searchJson = (
  value: unknown,
  query: string,
): { matches: Set<string>; open: Set<string> } => {
  const found = { matches: new Set<string>(), open: new Set<string>() };
  const needle = query.trim().toLowerCase();
  if (needle) visitMatches(value, [], needle, found);
  return found;
};

// Whether the node at `path`, or anything under it, matches; containers above a match open.
const visitMatches = (
  node: unknown,
  path: (string | number)[],
  needle: string,
  found: { matches: Set<string>; open: Set<string> },
): boolean => {
  const key = path.at(-1);
  const keyMatches = typeof key === "string" && key.toLowerCase().includes(needle);
  const isContainer = node !== null && typeof node === "object";
  const below = isContainer
    ? entriesOf(node)
        .map(([childKey, child]) => visitMatches(child, [...path, childKey], needle, found))
        .some(Boolean)
    : false;
  const valueMatches = !isContainer && String(node).toLowerCase().includes(needle);
  if (keyMatches || valueMatches) found.matches.add(pathKey(path));
  if (isContainer && (below || keyMatches)) found.open.add(pathKey(path));
  return keyMatches || valueMatches || below;
};

/** A container's children in order: an array's by index, an object's by key. */
export const entriesOf = (node: object): [string | number, unknown][] =>
  Array.isArray(node) ? node.map((child, index) => [index, child]) : Object.entries(node);

/** The paths of every container down to `depth` levels below the root (the root is 0). */
export const pathsToDepth = (value: unknown, depth: number): Set<string> => {
  const open = new Set<string>();
  const visit = (node: unknown, path: (string | number)[]) => {
    if (node === null || typeof node !== "object" || path.length > depth) return;
    open.add(pathKey(path));
    for (const [key, child] of entriesOf(node)) visit(child, [...path, key]);
  };
  visit(value, []);
  return open;
};
