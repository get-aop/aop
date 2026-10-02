import { channelDefine, parseReleaseChannel } from "@aop/common";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  // AOP_BUILD_CHANNEL=nightly builds AOP Nightly's screens (docs/NIGHTLY.md).
  define: channelDefine(parseReleaseChannel(process.env.AOP_BUILD_CHANNEL)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 25170,
    strictPort: true,
  },
});
