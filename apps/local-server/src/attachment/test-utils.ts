import type { UploadedChatImage } from "@aop/common";
import type { ProjectStack } from "../project/test-utils.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];

/** Bytes that start like a real file of the type, then filler: the host reads only the signature. */
export const fakePng = (size = 64): Uint8Array => withSignature(PNG_SIGNATURE, size);
export const fakeJpeg = (size = 64): Uint8Array => withSignature(JPEG_SIGNATURE, size);

const withSignature = (signature: number[], size: number): Uint8Array => {
  const bytes = new Uint8Array(size).fill(7);
  bytes.set(signature);
  return bytes;
};

/** POSTs raw bytes as an upload, the way the dashboard does. */
export const uploadRaw = async (
  s: ProjectStack,
  projectId: string,
  bytes: Uint8Array,
  contentType = "image/png",
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await s.app.request(`/api/projects/${projectId}/attachments`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/** Uploads an image and returns it; a refusal fails the test. */
export const upload = async (
  s: ProjectStack,
  projectId: string,
  bytes: Uint8Array = fakePng(),
): Promise<UploadedChatImage> => {
  const { status, body } = await uploadRaw(s, projectId, bytes);
  if (status !== 201) throw new Error(`upload refused: ${status} ${JSON.stringify(body)}`);
  return body.image as UploadedChatImage;
};
