import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findStaged,
  isUploadId,
  pruneStaleUploads,
  STALE_UPLOAD_MS,
  stageUpload,
  uploadsDir,
} from "./staging.ts";

let previousHome: string | undefined;
let home = "";
beforeAll(() => {
  previousHome = process.env.AOP_HOME;
  home = mkdtempSync(join(tmpdir(), "aop-staging-"));
  process.env.AOP_HOME = home;
});
afterAll(() => {
  if (previousHome === undefined) delete process.env.AOP_HOME;
  else process.env.AOP_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

const ID_A = "img_01k0000000000000000000000a";
const ID_B = "img_01k0000000000000000000000b";

describe("staged uploads", () => {
  test("only ids the host could have made name a file", async () => {
    expect(isUploadId(ID_A)).toBe(true);
    expect(isUploadId("../../etc/passwd")).toBe(false);
    expect(isUploadId("img_short")).toBe(false);
    expect(await findStaged("proj_1", "../proj_2/uploads/x")).toBeNull();
  });

  test("an upload is found with its type, and pruned once it is a day old", async () => {
    await stageUpload("proj_1", ID_A, "image/jpeg", new Uint8Array([1, 2, 3]));
    await stageUpload("proj_1", ID_B, "image/png", new Uint8Array([4]));
    const old = (Date.now() - STALE_UPLOAD_MS - 60_000) / 1000;
    utimesSync(join(uploadsDir("proj_1"), `${ID_A}.jpg`), old, old);

    expect(await findStaged("proj_1", ID_A)).toEqual({
      path: join(uploadsDir("proj_1"), `${ID_A}.jpg`),
      mimeType: "image/jpeg",
    });
    expect(await findStaged("proj_2", ID_A)).toBeNull();

    await pruneStaleUploads("proj_1");

    expect(existsSync(join(uploadsDir("proj_1"), `${ID_A}.jpg`))).toBe(false);
    expect(await findStaged("proj_1", ID_B)).not.toBeNull();
  });
});
