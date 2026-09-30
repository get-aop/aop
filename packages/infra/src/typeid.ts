import { typeidUnboxed } from "typeid-js";

export type TypeIdPrefix =
  | "task"
  | "exec"
  | "repo"
  | "step"
  | "isess"
  | "proj"
  | "smsg"
  | "crun"
  | "agent"
  | "chan"
  | "cmsg"
  | "asgn"
  | "rte"
  | "rtprov"
  | "rtmodel"
  | "ehost";

export const generateTypeId = (prefix: TypeIdPrefix): string => typeidUnboxed(prefix);
