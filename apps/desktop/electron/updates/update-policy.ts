/**
 * THE SWITCH: whether the macOS app updates itself with electron-updater.
 *
 * Off until the macOS app is Developer ID signed and notarized, because Squirrel.Mac installs an
 * update only over a signed app. While it is off the Mac app shows a notice with a link to the new
 * DMG instead. Flip it when signing is turned on (docs/RELEASE.md, "Desktop app updates"); the
 * release workflow must then also publish `latest-mac.yml` and the DMG's zip, which it does not
 * today. Nothing else in the app changes: both platforms use the same code path.
 */
export const MAC_AUTO_UPDATE_ENABLED = false;

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
  /** Overridable so a test can try both positions of the switch. */
  macAutoUpdate?: boolean;
}

export const chooseUpdateMode = ({
  platform,
  packaged,
  disabled,
  macAutoUpdate = MAC_AUTO_UPDATE_ENABLED,
}: UpdatePolicyInput): UpdateMode => {
  if (disabled) return "off";
  if (platform === "win32") return packaged ? "auto" : "off";
  if (platform === "darwin") {
    if (!macAutoUpdate) return "notice";
    return packaged ? "auto" : "off";
  }
  // The desktop app ships for macOS and Windows only.
  return "off";
};
