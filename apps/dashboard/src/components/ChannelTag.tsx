import { buildChannel, type ChannelConfig } from "@aop/common";

/**
 * "Nightly" beside the brand in AOP Nightly's dashboard, so it is never mistaken for the stable
 * AOP running on the same machine (docs/NIGHTLY.md). A stable dashboard shows nothing.
 */
export const ChannelTag = ({ channel = buildChannel() }: { channel?: ChannelConfig }) =>
  channel.id === "nightly" ? (
    <span data-testid="channel-tag" className="text-[11.5px] font-semibold text-favorite">
      Nightly
    </span>
  ) : null;
