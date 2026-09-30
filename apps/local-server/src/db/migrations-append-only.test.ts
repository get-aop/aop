import { describe, expect, test } from "bun:test";
import { MIGRATIONS, type Migration } from "./migrations.ts";

/**
 * A database that applied a version never runs it again, so editing a released version
 * silently forks fresh databases from upgraded ones. Fixing a released version's schema means
 * appending the next version. The digest of every version that has reached main is pinned
 * here, since builds from main are what people run; adding a new version to the registry needs
 * no edit to this file, and its digest joins the list when it merges. To print one:
 * `sha256(JSON.stringify([version, name, statements]))`.
 */
const RELEASED_DIGESTS: Record<number, string> = {
  1: "321a04affb9e5ccf07d964bc749eb8290048dec2384463ebe5bd78546e1dd3b4",
  2: "36f17155392e9f264e959f20b5fd84872060966470dc5360d5f02e0a5e558175",
  3: "4e4891e28e7568150f0884b5a517bf3d015df3ecf4ab4b14cbff0d606f155d86",
  4: "fafedc49ee2694d34c6da9f350aa64837dd81aa8a3ca54c1f799dec980a5dc63",
  5: "83aa45cf0f4c128eb5c7985e68602bd691a85c2194f5dd18dc5528e384d84f6d",
  6: "f27cb4d44826454791532bea1bae2bf43cfe90861e50c090094a22418d80ce8c",
  7: "dccaa5d951b8d83eaebb46f2cc254f1289ebc107085ec97d74fad6776bb9f134",
  8: "875790fff6d41b59bafd656a0be2e059e54689e90daee615ccc7e8080fa59865",
  9: "319ac143f0408f221d3af8dde4bd5530f322ad80abc2ff90afeeda90572de852",
  10: "8fb49ea1991e0e97a4b5432c874e2436242fa7eec75028388ceeb14a6414089a",
};

const digest = (migration: Migration): string =>
  new Bun.CryptoHasher("sha256")
    .update(JSON.stringify([migration.version, migration.name, migration.statements]))
    .digest("hex");

describe("the migration registry is append-only", () => {
  test("versions count up from 1 with no gap and no reused name", () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(
      MIGRATIONS.map((_, index) => index + 1),
    );
    const names = MIGRATIONS.map((migration) => migration.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every version has at least one statement", () => {
    for (const migration of MIGRATIONS) {
      expect(migration.statements.length).toBeGreaterThan(0);
    }
  });

  test("a released version keeps the exact name and statements it shipped with", () => {
    const changed = MIGRATIONS.filter(
      (migration) =>
        RELEASED_DIGESTS[migration.version] !== undefined &&
        RELEASED_DIGESTS[migration.version] !== digest(migration),
    ).map((migration) => `v${migration.version} ${migration.name}`);

    expect(changed).toEqual([]);
  });

  test("no released version was removed or reordered", () => {
    const released = Object.keys(RELEASED_DIGESTS).map(Number);

    expect(MIGRATIONS.slice(0, released.length).map((migration) => migration.version)).toEqual(
      released,
    );
  });
});
