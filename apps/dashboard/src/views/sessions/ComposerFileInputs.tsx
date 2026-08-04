import { CHAT_DOCUMENT_LIMITS, CREATE_TASK_IMAGE_LIMITS } from "@aop/common";

export const ComposerFileInputs = ({
  imageRef,
  documentRef,
  onImages,
  onDocuments,
}: {
  imageRef: React.RefObject<HTMLInputElement | null>;
  documentRef: React.RefObject<HTMLInputElement | null>;
  onImages: (files: FileList | null) => void;
  onDocuments: (files: FileList | null) => void;
}) => (
  <>
    <input
      ref={imageRef}
      type="file"
      accept={CREATE_TASK_IMAGE_LIMITS.allowedMimeTypes.join(",")}
      multiple
      className="hidden"
      aria-label="Attach images"
      onChange={(event) => {
        onImages(event.target.files);
        event.target.value = "";
      }}
    />
    <input
      ref={documentRef}
      type="file"
      accept={CHAT_DOCUMENT_LIMITS.allowedExtensions.map((extension) => `.${extension}`).join(",")}
      multiple
      className="hidden"
      aria-label="Attach documents"
      onChange={(event) => {
        onDocuments(event.target.files);
        event.target.value = "";
      }}
    />
  </>
);
