import type { JsonFile } from "./json-file";
import type { Keychain } from "./keychain";

/** Device tokens, one per host address, kept encrypted by the OS keychain. */
export interface TokenStore {
  isAvailable: () => boolean;
  /** Throws `KeychainUnavailableError` rather than store a token the OS cannot protect. */
  save: (hostUrl: string, token: string) => Promise<void>;
  /** The token, or null when there is none or the keychain can no longer read it. */
  load: (hostUrl: string) => Promise<string | null>;
  remove: (hostUrl: string) => Promise<void>;
}

/** What is on disk: the token encrypted by the keychain, as base64, under its host. */
export type EncryptedTokens = Record<string, string>;

export class KeychainUnavailableError extends Error {
  constructor() {
    super(
      "The operating system's keychain is not available, so the device token cannot be stored safely.",
    );
    this.name = "KeychainUnavailableError";
  }
}

export const createTokenStore = (
  keychain: Keychain,
  file: JsonFile<EncryptedTokens>,
): TokenStore => ({
  isAvailable: () => keychain.isAvailable(),

  save: async (hostUrl, token) => {
    if (!keychain.isAvailable()) throw new KeychainUnavailableError();
    const stored = await file.read();
    stored[hostUrl] = Buffer.from(keychain.encrypt(token)).toString("base64");
    await file.write(stored);
  },

  load: async (hostUrl) => {
    const cipher = (await file.read())[hostUrl];
    if (cipher === undefined || !keychain.isAvailable()) return null;
    try {
      return keychain.decrypt(Buffer.from(cipher, "base64"));
    } catch {
      // The keychain changed under us (a new login keychain, a restored profile): pair again.
      return null;
    }
  },

  remove: async (hostUrl) => {
    const stored = await file.read();
    if (!(hostUrl in stored)) return;
    delete stored[hostUrl];
    await file.write(stored);
  },
});

export const parseEncryptedTokens = (raw: unknown): EncryptedTokens => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};
