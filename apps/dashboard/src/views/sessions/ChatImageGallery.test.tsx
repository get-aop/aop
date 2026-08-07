import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, render } = await import("@testing-library/react");
const { ChatImageGallery } = await import("./ChatImageGallery");

afterEach(cleanup);

describe("ChatImageGallery", () => {
  test("defers attachment thumbnails until they approach the viewport", () => {
    const { getByAltText } = render(
      <ChatImageGallery
        images={[
          {
            id: "image-1",
            url: "/api/chat-sessions/session-1/images/image-1",
            mimeType: "image/png",
          },
        ]}
      />,
    );

    const image = getByAltText("Attachment 1") as HTMLImageElement;
    expect(image.loading).toBe("lazy");
    expect(image.decoding).toBe("async");
  });
});
