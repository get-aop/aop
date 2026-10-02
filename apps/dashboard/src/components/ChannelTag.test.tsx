import { describe, expect, test } from "bun:test";
import { CHANNELS } from "@aop/common";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelTag } from "./ChannelTag";

describe("ChannelTag", () => {
  test("says Nightly in AOP Nightly's dashboard and nothing in stable's", () => {
    expect(renderToStaticMarkup(<ChannelTag channel={CHANNELS.nightly} />)).toContain(
      ">Nightly</span>",
    );
    expect(renderToStaticMarkup(<ChannelTag />)).toBe("");
  });
});
