import { typeidUnboxed } from "typeid-js";

export type TypeIdPrefix =
  | "repo"
  | "isess"
  | "proj"
  | "smsg"
  | "crun"
  | "rtprov"
  | "rtmodel"
  | "img";

export const generateTypeId = (prefix: TypeIdPrefix): string => typeidUnboxed(prefix);
