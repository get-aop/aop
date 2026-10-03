import { buildChannel, normalizeReleaseVersion, type ReleaseChannel } from "@aop/common";

/** The release this host runs, and the channel it was built for. */
export interface HostBuild {
  /** `0.10.8`, `0.10.8-nightly.20261003.4`, or `dev` for a source checkout. */
  version: string;
  channel: ReleaseChannel;
}

/** `AOP_BUILD_VERSION` is set by the compiled `aop` when it starts the server; a checkout has none. */
export const hostBuild = (env: NodeJS.ProcessEnv = process.env): HostBuild => {
  const version = env.AOP_BUILD_VERSION?.trim();
  return {
    version: version ? normalizeReleaseVersion(version) : "dev",
    channel: buildChannel().id,
  };
};
