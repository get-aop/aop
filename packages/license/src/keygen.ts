import { generateKeyPairSync } from "node:crypto";

export interface LicenseSigningKeyPair {
  publicDerB64: string;
  privateDerB64: string;
}

export const generateLicenseSigningKeyPair = (): LicenseSigningKeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicDerB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateDerB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
};
