import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonFile } from "./json-file";
import { createSafeStorageKeychain, type SafeStorageLike } from "./keychain";
import { createFakeKeychain, createMemoryFile } from "./test-utils";
import {
  createTokenStore,
  type EncryptedTokens,
  KeychainUnavailableError,
  parseEncryptedTokens,
} from "./token-store";

const HOST = "https://mac.tail1234.ts.net";
const TOKEN = "aop_3f9c0d3c8a7e4b1f";

describe("token store", () => {
  test("gives back the token it was given, per host", async () => {
    const { keychain } = createFakeKeychain();
    const store = createTokenStore(keychain, createMemoryFile<EncryptedTokens>({}));

    await store.save(HOST, TOKEN);
    await store.save("https://other.example", "aop_other");

    expect(await store.load(HOST)).toBe(TOKEN);
    expect(await store.load("https://other.example")).toBe("aop_other");
    expect(await store.load("https://unknown.example")).toBeNull();
  });

  test("keeps only what the keychain sealed, never the token itself", async () => {
    const { keychain } = createFakeKeychain();
    const file = createMemoryFile<EncryptedTokens>({});

    await createTokenStore(keychain, file).save(HOST, TOKEN);

    const onDisk = JSON.stringify(file.current());
    expect(onDisk).not.toContain(TOKEN);
    expect(Buffer.from(file.current()[HOST] ?? "", "base64").toString()).toStartWith("sealed(");
  });

  test("refuses to store a token when the keychain cannot protect it", async () => {
    const { keychain } = createFakeKeychain(false);
    const file = createMemoryFile<EncryptedTokens>({});
    const store = createTokenStore(keychain, file);

    await expect(store.save(HOST, TOKEN)).rejects.toBeInstanceOf(KeychainUnavailableError);
    expect(file.current()).toEqual({});
    expect(store.isAvailable()).toBe(false);
  });

  test("reads no token while the keychain is unavailable, and again once it is back", async () => {
    const { keychain, state } = createFakeKeychain();
    const store = createTokenStore(keychain, createMemoryFile<EncryptedTokens>({}));
    await store.save(HOST, TOKEN);

    state.available = false;
    expect(await store.load(HOST)).toBeNull();

    state.available = true;
    expect(await store.load(HOST)).toBe(TOKEN);
  });

  test("treats a token the keychain cannot open as missing, so the person pairs again", async () => {
    const { keychain } = createFakeKeychain();
    const file = createMemoryFile<EncryptedTokens>({ [HOST]: "bm90LXNlYWxlZA==" });

    expect(await createTokenStore(keychain, file).load(HOST)).toBeNull();
  });

  test("removes one host's token and leaves the others", async () => {
    const { keychain } = createFakeKeychain();
    const store = createTokenStore(keychain, createMemoryFile<EncryptedTokens>({}));
    await store.save(HOST, TOKEN);
    await store.save("https://other.example", "aop_other");

    await store.remove(HOST);
    await store.remove("https://never-saved.example");

    expect(await store.load(HOST)).toBeNull();
    expect(await store.load("https://other.example")).toBe("aop_other");
  });
});

describe("token store on disk", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aop-tokens-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("writes a file only its owner can read, with no plain-text token in it", async () => {
    const path = join(dir, "nested", "device-tokens.json");
    const { keychain } = createFakeKeychain();
    const store = createTokenStore(
      keychain,
      createJsonFile(path, parseEncryptedTokens, () => ({})),
    );

    await store.save(HOST, TOKEN);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain(TOKEN);
    expect(await store.load(HOST)).toBe(TOKEN);
  });

  test("starts empty when the file is missing or damaged", async () => {
    const path = join(dir, "device-tokens.json");
    const file = createJsonFile(path, parseEncryptedTokens, () => ({}));
    expect(await file.read()).toEqual({});

    await Bun.write(path, "{ not json");
    expect(await file.read()).toEqual({});
  });
});

describe("createSafeStorageKeychain", () => {
  const safeStorage = (overrides: Partial<SafeStorageLike> = {}): SafeStorageLike => ({
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${text}`),
    decryptString: (buffer) => buffer.toString().replace(/^enc:/, ""),
    ...overrides,
  });

  test("encrypts and decrypts through Electron's safeStorage", () => {
    const keychain = createSafeStorageKeychain(safeStorage());

    expect(keychain.isAvailable()).toBe(true);
    expect(keychain.decrypt(keychain.encrypt(TOKEN))).toBe(TOKEN);
  });

  test("is unavailable when the OS cannot encrypt", () => {
    expect(
      createSafeStorageKeychain(safeStorage({ isEncryptionAvailable: () => false })).isAvailable(),
    ).toBe(false);
  });

  test("is unavailable on a Linux desktop with no keyring, where safeStorage would use a fixed key", () => {
    expect(
      createSafeStorageKeychain(
        safeStorage({ getSelectedStorageBackend: () => "basic_text" }),
      ).isAvailable(),
    ).toBe(false);
    expect(
      createSafeStorageKeychain(
        safeStorage({ getSelectedStorageBackend: () => "gnome_libsecret" }),
      ).isAvailable(),
    ).toBe(true);
  });
});
