/**
 * How the app keeps itself current. `auto` downloads in the background and installs on restart,
 * `notice` only says a newer release exists and links to it, `off` does nothing.
 */
export type UpdateMode = "auto" | "notice" | "off";

export interface UpdatePolicyInput {
  platform: NodeJS.Platform;
  /** A packaged app carries the `app-update.yml` electron-updater needs; a development run does not. */
  packaged: boolean;
  /** `AOP_DESKTOP_DISABLE_UPDATES=1`. */
  disabled: boolean;
  /**
   * The macOS app is Developer ID signed (mac-signature.ts). Squirrel.Mac installs an update only
   * over a signed app, so an ad-hoc signed one shows a notice with a link to the new DMG instead.
   * A release built with `AOP_SIGN_RELEASES` on is signed, and from then on the app updates
   * itself; nothing in the code needs to change (docs/RELEASE.md, "Desktop app updates").
   */
  macSigned: boolean;
  /**
   * `AOP_DESKTOP_UPDATE_MODE`: a development run on Linux, where updates are otherwise off, can
   * show the "This app" row against a fake feed (`notice`), or its failure (`auto`).
   */
  forced?: string | null;
}

export const chooseUpdateMode = ({
  platform,
  packaged,
  disabled,
  macSigned,
  forced,
}: UpdatePolicyInput): UpdateMode => {
  if (disabled) return "off";
  if (isUpdateMode(forced)) return forced;
  if (platform === "win32") return packaged ? "auto" : "off";
  if (platform === "darwin") {
    if (!macSigned) return "notice";
    return packaged ? "auto" : "off";
  }
  // The desktop app ships for macOS and Windows only.
  return "off";
};

const isUpdateMode = (value: string | null | undefined): value is UpdateMode =>
  value === "auto" || value === "notice" || value === "off";
