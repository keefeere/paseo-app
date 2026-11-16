import { persistAttachmentFromBytes } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";
import { createAssistantImageFileAcquisition } from "@/assistant-image/file-acquisition";
import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import type { UserMessageImage } from "@/types/stream";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

/**
 * History images live in the daemon's conversation-image store and the store garbage-collects
 * ids no longer referenced by a timeline row. A rewind removes the row it restores, so the bytes
 * have to be copied to local attachments before the rewind call, not after.
 */
export interface CollectRewindImageAttachmentsInput {
  images: UserMessageImage[];
  agentId?: string;
  messageId?: string;
  serverId?: string;
  client?: DaemonClient | null;
  workspaceRoot?: string;
}

export function createRewindImageOccurrenceKey(input: {
  agentId?: string;
  messageId?: string;
  imageId: string;
}): string {
  return `user:${input.agentId ?? "unknown"}:${input.messageId ?? "unknown"}:${input.imageId}`;
}

export async function collectRewindImageAttachments(
  input: CollectRewindImageAttachmentsInput,
): Promise<AttachmentMetadata[]> {
  const seen = new Set<string>();
  const attachments: AttachmentMetadata[] = [];

  for (const image of input.images) {
    if ("source" in image) {
      const occurrenceKey = createRewindImageOccurrenceKey({
        agentId: input.agentId,
        messageId: input.messageId,
        imageId: image.id,
      });
      if (seen.has(occurrenceKey)) {
        continue;
      }
      seen.add(occurrenceKey);

      const acquisition = createAssistantImageFileAcquisition({
        port: input.client
          ? {
              readFile: (cwd, path) => input.client!.readFile(cwd, path),
              persist: persistAttachmentFromBytes,
            }
          : null,
        resolution: resolveAssistantImageSource({
          source: image.source,
          workspaceRoot: input.workspaceRoot,
        }),
        serverId: input.serverId,
        occurrenceKey,
        unavailableMessage: "Image unavailable",
      });
      if (!acquisition) {
        continue;
      }
      try {
        attachments.push(await acquisition.locate());
      } catch {
        // A missing history image must not block the rewind; the text still comes back.
        continue;
      }
      continue;
    }

    if (seen.has(image.id)) {
      continue;
    }
    seen.add(image.id);
    attachments.push(image);
  }

  return attachments;
}
