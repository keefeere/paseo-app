import { useEffect } from "react";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import type { AttachmentMetadata } from "@/attachments/types";

/**
 * Keeps a persisted attachment's bytes alive while the caller holds its metadata.
 *
 * History images are read from the daemon and written into the local attachment store under an id
 * derived from the file (`preview_*`), which no draft, queued message, or stream row references.
 * Garbage collection deletes by that id, so an unretained preview file disappears while the pill is
 * still on screen and the preview URL then fails to resolve.
 */
export function useRetainedAttachment(attachment: AttachmentMetadata | null | undefined): void {
  const attachmentId = attachment?.id;
  useEffect(() => {
    if (!attachmentId) {
      return;
    }
    return retainAttachmentForGarbageCollection(attachmentId);
  }, [attachmentId]);
}
