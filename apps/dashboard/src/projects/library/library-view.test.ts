import { describe, expect, test } from "bun:test";
import {
  allFolders,
  crumbsOf,
  daysLeft,
  expiresSoon,
  expiryLabel,
  formatBytes,
  libraryView,
} from "./library-view";
import { makeItem, NOW } from "./test-utils";

const items = [
  makeItem({ id: "a", name: "audit.md", folder: "Reports/Q3", size: 100, daysAgo: 3 }),
  makeItem({ id: "b", name: "plan.md", folder: "Reports", size: 300, daysAgo: 1 }),
  makeItem({
    id: "c",
    name: "screen.png",
    folder: "Sent in chat",
    mimeType: "image/png",
    size: 900,
    daysAgo: 2,
    description: "the checkout bug",
  }),
  makeItem({
    id: "d",
    name: "notes.txt",
    folder: "",
    mimeType: "text/plain",
    size: 50,
    daysAgo: 0,
  }),
  makeItem({ id: "e", name: "main.ts", folder: "Reports/Q3", mimeType: "text/plain", size: 10 }),
];

const view = (options: Partial<Parameters<typeof libraryView>[1]> = {}) =>
  libraryView(items, { folder: "", search: "", type: "all", sort: "newest", ...options });

describe("libraryView", () => {
  test("the top level shows its folders, with what they hold, and its own files", () => {
    const top = view({ sort: "name" });

    expect(top.flat).toBe(false);
    expect(top.folders.map(({ name, count, size }) => ({ name, count, size }))).toEqual([
      { name: "Reports", count: 3, size: 410 },
      { name: "Sent in chat", count: 1, size: 900 },
    ]);
    expect(top.items.map((item) => item.id)).toEqual(["d"]);
  });

  test("a folder shows the folders inside it and its own files", () => {
    const reports = view({ folder: "Reports" });

    expect(reports.folders.map((folder) => folder.path)).toEqual(["Reports/Q3"]);
    expect(reports.items.map((item) => item.id)).toEqual(["b"]);
  });

  test("search looks in names, folders and descriptions across every folder", () => {
    expect(view({ search: "CHECKOUT" }).items.map((item) => item.id)).toEqual(["c"]);
    expect(
      view({ search: "q3" })
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(["a", "e"]);
    expect(view({ search: "q3" }).flat).toBe(true);
    expect(view({ search: "nothing like it" }).items).toEqual([]);
  });

  test("the type filter goes by kind: documents are markdown and text, code by extension", () => {
    const ids = (type: Parameters<typeof libraryView>[1]["type"]) =>
      view({ type, sort: "name" }).items.map((item) => item.id);

    expect(ids("image")).toEqual(["c"]);
    expect(ids("document")).toEqual(["a", "d", "b"]);
    expect(ids("code")).toEqual(["e"]);
    expect(ids("pdf")).toEqual([]);
  });

  test("sorts by date, size or name, both ways", () => {
    const order = (sort: Parameters<typeof libraryView>[1]["sort"]) =>
      view({ type: "document", sort }).items.map((item) => item.id);

    expect(order("newest")).toEqual(["d", "b", "a"]);
    expect(order("oldest")).toEqual(["a", "b", "d"]);
    expect(order("largest")).toEqual(["b", "a", "d"]);
    expect(order("smallest")).toEqual(["d", "a", "b"]);
    expect(order("name")).toEqual(["a", "d", "b"]);
  });
});

describe("folders and crumbs", () => {
  test("allFolders lists every path, parents included, once", () => {
    expect(allFolders(items)).toEqual(["Reports", "Reports/Q3", "Sent in chat"]);
  });

  test("crumbsOf walks from the top down", () => {
    expect(crumbsOf("Reports/Q3")).toEqual([
      { label: "Library", path: "" },
      { label: "Reports", path: "Reports" },
      { label: "Q3", path: "Reports/Q3" },
    ]);
    expect(crumbsOf("")).toEqual([{ label: "Library", path: "" }]);
  });
});

describe("formatting", () => {
  test("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  });

  test("an item's expiry in whole days, and when it is soon", () => {
    expect(expiryLabel(makeItem(), NOW)).toBeNull();
    expect(expiryLabel(makeItem({ expiresInDays: 12 }), NOW)).toBe("Removed in 12 days");
    expect(expiryLabel(makeItem({ expiresInDays: 0.5 }), NOW)).toBe("Removed in 1 day");
    expect(expiryLabel(makeItem({ expiresInDays: -1 }), NOW)).toBe("Removed at the next cleanup");
    expect(daysLeft(new Date(NOW + 36 * 3600 * 1000).toISOString(), NOW)).toBe(2);
    expect(expiresSoon(makeItem({ expiresInDays: 3 }), NOW)).toBe(true);
    expect(expiresSoon(makeItem({ expiresInDays: 4 }), NOW)).toBe(false);
  });
});
