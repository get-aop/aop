import type { JsonFile } from "./json-file";
import type { Keychain } from "./keychain";

/** A keychain that scrambles reversibly, so a test can tell what was stored from what was given. */
export const createFakeKeychain = (available = true) => {
  const state = { available };
  const keychain: Keychain = {
    isAvailable: () => state.available,
    encrypt: (plainText) =>
      new TextEncoder().encode(`sealed(${[...plainText].reverse().join("")})`),
    decrypt: (cipherText) => {
      const text = new TextDecoder().decode(cipherText);
      const inner = /^sealed\((.*)\)$/s.exec(text)?.[1];
      if (inner === undefined) throw new Error("cannot decrypt");
      return [...inner].reverse().join("");
    },
  };
  return { keychain, state };
};

export const createMemoryFile = <T>(initial: T): JsonFile<T> & { current: () => T } => {
  let stored = structuredClone(initial);
  return {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
    current: () => stored,
  };
};
