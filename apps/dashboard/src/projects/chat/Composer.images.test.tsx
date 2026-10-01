import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CHAT_IMAGE_LIMITS, type UploadedChatImage } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import type { SendResult } from "./project-chat";
import { deferred } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { Composer } = await import("./Composer");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const png = (name = "shot.png", size = 10) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

const input = () => screen.getByTestId("composer-input") as HTMLTextAreaElement;
const sendButton = () => screen.getByTestId("composer-send") as HTMLButtonElement;
const thumbnails = () => screen.queryAllByTestId("composer-image");
const pick = (...files: File[]) =>
  fireEvent.change(screen.getByTestId("composer-file-input"), { target: { files } });

let uploaded = 0;
const uploadOk = () =>
  mock(
    async (file: File): Promise<UploadedChatImage> => ({
      id: `img_${++uploaded}`,
      mimeType: "image/png",
      size: file.size,
    }),
  );

const renderComposer = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
  const send = mock(
    async (_text: string, _images?: readonly string[]): Promise<SendResult> => ({
      ok: true,
    }),
  );
  const uploadImage = uploadOk();
  render(
    <Composer
      draftId="proj_1"
      placeholder="Ask the coordinator"
      disabledReason={null}
      send={send}
      uploadImage={uploadImage}
      chips={<span data-testid="model-chip">Opus</span>}
      {...props}
    />,
  );
  return { send, uploadImage };
};

describe("attaching images", () => {
  test("the + sits before the model chips and its picker takes images", () => {
    renderComposer();

    const attach = screen.getByTestId("composer-attach");
    expect(attach.getAttribute("aria-label")).toBe("Attach images");
    expect(
      attach.compareDocumentPosition(screen.getByTestId("model-chip")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("composer-file-input").getAttribute("accept")).toBe(
      "image/png,image/jpeg,image/webp,image/gif",
    );
  });

  test("a picked image uploads, shows as a thumbnail, and goes with the message", async () => {
    const { send, uploadImage } = renderComposer();

    pick(png("a.png"), png("b.png"));
    await waitFor(() =>
      expect(thumbnails().map((thumb) => thumb.dataset.status)).toEqual(["ready", "ready"]),
    );
    fireEvent.change(input(), { target: { value: "compare these" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const uploads: UploadedChatImage[] = await Promise.all(
      uploadImage.mock.results.map((result) => result.value as Promise<UploadedChatImage>),
    );
    expect(uploadImage.mock.calls.map(([file]) => file.name)).toEqual(["a.png", "b.png"]);
    expect(send).toHaveBeenCalledWith(
      "compare these",
      uploads.map((image) => image.id),
    );
    await waitFor(() => expect(thumbnails()).toEqual([]));
  });

  test("a pasted image is attached instead of pasted; pasted text is left alone", async () => {
    renderComposer();

    const pasted = fireEvent.paste(input(), {
      clipboardData: { files: [png()], types: ["Files"] },
    });
    const text = fireEvent.paste(input(), { clipboardData: { files: [], types: ["text/plain"] } });

    expect(pasted).toBe(false);
    expect(text).toBe(true);
    await waitFor(() => expect(thumbnails()).toHaveLength(1));
  });

  test("an image dropped on the box is attached", async () => {
    renderComposer();
    const box = screen.getByTestId("composer");

    fireEvent.dragOver(box, { dataTransfer: { types: ["Files"], files: [] } });
    expect(box.dataset.dragging).toBe("true");
    fireEvent.drop(box, { dataTransfer: { types: ["Files"], files: [png()] } });

    expect(box.dataset.dragging).toBeUndefined();
    await waitFor(() => expect(thumbnails()).toHaveLength(1));
  });

  test("images alone can be sent", async () => {
    const { send } = renderComposer();

    expect(sendButton().disabled).toBe(true);
    pick(png());
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.click(sendButton());

    await waitFor(() => expect(send).toHaveBeenCalledWith("", [expect.any(String)]));
  });

  test("the cross takes an image out", async () => {
    const { send } = renderComposer();
    pick(png("keep.png"), png("drop.png"));
    await waitFor(() => expect(thumbnails()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Remove drop.png" }));
    fireEvent.change(input(), { target: { value: "one image" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1]).toHaveLength(1);
  });

  test("a message waits for its images to upload, and one that failed must be removed first", async () => {
    const upload = deferred<UploadedChatImage>();
    const failing = mock(async (): Promise<UploadedChatImage> => {
      throw new Error("Images must be 10 MB or smaller");
    });
    const { send } = renderComposer({ uploadImage: mock(() => upload.promise) });
    fireEvent.change(input(), { target: { value: "look" } });
    pick(png("slow.png"));

    await waitFor(() => expect(thumbnails()[0]?.dataset.status).toBe("uploading"));
    expect(sendButton().disabled).toBe(true);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    await act(async () => upload.resolve({ id: "img_slow", mimeType: "image/png", size: 10 }));
    await waitFor(() => expect(sendButton().disabled).toBe(false));

    cleanup();
    renderComposer({ uploadImage: failing });
    fireEvent.change(input(), { target: { value: "look" } });
    pick(png("big.png"));
    await waitFor(() => expect(thumbnails()[0]?.dataset.status).toBe("failed"));
    expect(screen.getByTestId("composer-error").textContent).toBe(
      "big.png did not upload: Images must be 10 MB or smaller. Remove it to send.",
    );
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove big.png" }));
    expect(sendButton().disabled).toBe(false);
  });

  test("refuses what is not an image, what is too large, and more than a message takes", async () => {
    const { uploadImage } = renderComposer();

    pick(new File(["%PDF"], "doc.pdf", { type: "application/pdf" }));
    expect(screen.getByTestId("composer-error").textContent).toBe(
      "Attach PNG, JPEG, GIF or WebP images",
    );
    pick(png("huge.png", CHAT_IMAGE_LIMITS.maxBytes + 1));
    expect(screen.getByTestId("composer-error").textContent).toBe("huge.png is over 10 MB");
    pick(
      ...Array.from({ length: CHAT_IMAGE_LIMITS.maxCount + 1 }, (_, index) => png(`${index}.png`)),
    );

    expect(screen.getByTestId("composer-error").textContent).toBe("A message takes up to 5 images");
    expect(thumbnails()).toHaveLength(CHAT_IMAGE_LIMITS.maxCount);
    expect(uploadImage).toHaveBeenCalledTimes(CHAT_IMAGE_LIMITS.maxCount);
  });

  test("an image added while a message is being sent stays for the next one", async () => {
    const sending = deferred<SendResult>();
    const send = mock((_text: string, _images?: readonly string[]) => sending.promise);
    renderComposer({ send });
    pick(png("first.png"));
    await waitFor(() => expect(sendButton().disabled).toBe(false));

    fireEvent.click(sendButton());
    pick(png("second.png"));
    await waitFor(() => expect(thumbnails()).toHaveLength(2));
    await act(async () => sending.resolve({ ok: true }));

    await waitFor(() => expect(thumbnails()).toHaveLength(1));
    expect(thumbnails()[0]?.title).toBe("second.png");
  });

  test("a refused send keeps the images for another try", async () => {
    const { send } = renderComposer({
      send: mock(async () => ({ ok: false, error: "The project is paused" }) as SendResult),
    });
    pick(png());
    await waitFor(() => expect(sendButton().disabled).toBe(false));

    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(screen.getByTestId("composer-error").textContent).toBe("The project is paused"),
    );
    expect(thumbnails()).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  test("without an upload, or while the box is disabled, nothing can be attached", () => {
    render(
      <Composer
        draftId="thr_1"
        placeholder="Answer"
        disabledReason={null}
        send={async () => ({ ok: true })}
      />,
    );
    expect(screen.queryByTestId("composer-attach")).toBeNull();
    const ignored = fireEvent.paste(input(), {
      clipboardData: { files: [png()], types: ["Files"] },
    });
    expect(ignored).toBe(true);

    cleanup();
    renderComposer({ disabledReason: "The project is paused" });
    expect((screen.getByTestId("composer-attach") as HTMLButtonElement).disabled).toBe(true);
  });
});
