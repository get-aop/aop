import { TypeID, typeidUnboxed } from "typeid-js";

export type TypeIdPrefix =
  | "repo"
  | "isess"
  | "proj"
  | "smsg"
  | "crun"
  | "rtprov"
  | "rtmodel"
  | "img"
  | "rtn"
  | "rrun"
  | "lib"
  | "inbx"
  | "inlk";

export const generateTypeId = (prefix: TypeIdPrefix): string => typeidUnboxed(prefix);

/** The UUID a TypeID encodes, for systems that take UUIDs only; null when `id` is not a TypeID. */
export const typeIdToUuid = (id: string): string | null => {
  try {
    return TypeID.fromString(id).toUUID();
  } catch {
    return null;
  }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The TypeID of `prefix` that encodes `uuid`; null when `uuid` is not one. */
export const typeIdFromUuid = (prefix: TypeIdPrefix, uuid: string): string | null =>
  UUID.test(uuid) ? TypeID.fromUUID(prefix, uuid).toString() : null;
