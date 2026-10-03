import { type ChannelConfig, parseInstallWindow, type SetupCheck } from "@aop/common";
import type { UpdatesLook } from "./probes.ts";

/** "Updates": the channel and when the host installs a new build, linking AOP settings › Updates. */
export const updatesCheck = (look: UpdatesLook, channel: ChannelConfig): SetupCheck => ({
  id: "updates",
  state: "ok",
  title: "Updates",
  detail: updatesDetail(look, channel),
  actions: [{ kind: "link", label: "Updates", target: "updates" }],
});

const updatesDetail = (look: UpdatesLook, channel: ChannelConfig): string => {
  if (look.block === "source") return "Runs from source: pull and rebuild";
  if (look.block === "app") return `Updates with the ${channel.productName} app`;
  const name = channel.id === "nightly" ? "Nightly" : "Stable";
  if (!look.checking) return `${name}, doesn't check for updates`;
  return `${name}, ${installWords(look)}`;
};

const installWords = (look: UpdatesLook): string => {
  switch (look.mode) {
    case "ask":
      return "asks before installing";
    case "idle":
      return "installs automatically when idle";
    case "window":
      return `installs automatically ${windowWords(look.window)} when idle`;
  }
};

const windowWords = (window: string | null): string => {
  const parsed = window ? parseInstallWindow(window) : null;
  if (!parsed || !window) return "at night";
  const [start, end] = window.split("-");
  return `between ${start} and ${end}`;
};
