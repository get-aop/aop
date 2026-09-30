/**
 * What the app needs from the operating system's secret store. Electron's `safeStorage` is the
 * real one (Keychain on macOS, DPAPI on Windows); tests bring their own, so the token store can
 * be exercised without a keychain.
 */
export interface Keychain {
  /** False when the OS cannot protect a secret, in which case nothing must be stored. */
  isAvailable: () => boolean;
  encrypt: (plainText: string) => Uint8Array;
  decrypt: (cipherText: Uint8Array) => string;
}

/** The part of Electron's `safeStorage` this adapter uses. */
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (cipherText: Buffer) => string;
  /** Linux only: `basic_text` means the key is a fixed string, which protects nothing. */
  getSelectedStorageBackend?: () => string;
}

export const createSafeStorageKeychain = (safeStorage: SafeStorageLike): Keychain => ({
  isAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== "basic_text",
  encrypt: (plainText) => safeStorage.encryptString(plainText),
  decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText)),
});
