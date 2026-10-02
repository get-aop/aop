import type { LibraryItem, LibraryListing } from "@aop/common";

export const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** An item `daysAgo` old, kept by default; pass `expiresInDays` for one retention will take. */
export const makeItem = ({
  expiresInDays,
  daysAgo = 1,
  ...overrides
}: Partial<LibraryItem> & { expiresInDays?: number; daysAgo?: number } = {}): LibraryItem => {
  const at = new Date(NOW - daysAgo * DAY).toISOString();
  return {
    id: "lib_1",
    name: "report.md",
    folder: "Artifacts",
    description: "",
    source: "artifact",
    mimeType: "text/markdown",
    size: 2048,
    pinned: false,
    createdAt: at,
    updatedAt: at,
    lastAccessedAt: at,
    expiresAt:
      expiresInDays === undefined ? null : new Date(NOW + expiresInDays * DAY).toISOString(),
    usedIn: null,
    ...overrides,
  };
};

export const makeListing = (
  items: LibraryItem[],
  overrides: Partial<LibraryListing> = {},
): LibraryListing => ({
  items,
  usage: {
    bytes: items.reduce((total, item) => total + item.size, 0),
    capBytes: 1024 * 1024 * 1024,
    hostBytes: 50 * 1024 * 1024,
    hostCapBytes: 5 * 1024 * 1024 * 1024,
  },
  retention: { retentionDays: 30, capMb: 1024 },
  settings: { retentionDays: null, capMb: null },
  defaults: { retentionDays: 30, capMb: 1024 },
  ...overrides,
});
