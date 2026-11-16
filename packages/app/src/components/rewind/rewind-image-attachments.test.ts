import { beforeEach, describe, expect, test, vi } from "vitest";
import { collectRewindImageAttachments } from "./rewind-image-attachments";
import type { AttachmentMetadata } from "@/attachments/types";
import type { AgentTimelineImage } from "@getpaseo/protocol/agent-types";
import type { UserMessageImage } from "@/types/stream";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const persistAttachmentFromBytes = vi.hoisted(() =>
  vi.fn(
    async (input: {
      id: string;
      bytes: Uint8Array;
      mimeType: string;
      fileName: string | null;
    }): Promise<AttachmentMetadata> => ({
      id: input.id,
      mimeType: input.mimeType,
      storageType: "desktop-file",
      storageKey: `/attachments/${input.id}`,
      fileName: input.fileName,
      byteSize: input.bytes.byteLength,
      createdAt: 1,
    }),
  ),
);

vi.mock("@/attachments/service", () => ({ persistAttachmentFromBytes }));

beforeEach(() => {
  persistAttachmentFromBytes.mockClear();
});

const HISTORY_IMAGE_SOURCE = "/home/keefeere/.paseo/conversation-images/c15bcb86.jpg";

function historyImage(id: string): AgentTimelineImage {
  return {
    id,
    mimeType: "image/jpeg",
    source: HISTORY_IMAGE_SOURCE,
    byteSize: 2249963,
  };
}

function clientReading(imageBytes: Uint8Array): DaemonClient {
  return {
    readFile: async (_cwd: string, path: string) => ({
      kind: "image",
      path,
      mime: "image/jpeg",
      size: imageBytes.byteLength,
      modifiedAt: "1",
      bytes: imageBytes,
    }),
  } as unknown as DaemonClient;
}

function failingClient(): DaemonClient {
  return {
    readFile: async () => {
      throw new Error("Image unavailable");
    },
  } as unknown as DaemonClient;
}

describe("collectRewindImageAttachments", () => {
  test("copies a history image into a local attachment before the rewind", async () => {
    const attachments = await collectRewindImageAttachments({
      images: [historyImage("c15bcb86")],
      agentId: "agent-1",
      messageId: "msg-1",
      serverId: "server-1",
      client: clientReading(new Uint8Array([1, 2, 3])),
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.mimeType).toBe("image/jpeg");
    expect(persistAttachmentFromBytes).toHaveBeenCalledTimes(1);
    const persisted = persistAttachmentFromBytes.mock.calls[0]?.[0];
    expect(persisted?.id).toMatch(/^preview_/);
    expect(persisted?.fileName).toBe("c15bcb86.jpg");
  });

  test("keeps an already-local attachment as it is", async () => {
    const local: UserMessageImage = {
      id: "att_msg_1",
      mimeType: "image/png",
      storageType: "desktop-file",
      storageKey: "/attachments/att_msg_1.png",
      createdAt: 1,
    };

    const attachments = await collectRewindImageAttachments({
      images: [local],
      agentId: "agent-1",
      messageId: "msg-1",
      client: null,
    });

    expect(attachments).toEqual([local]);
    expect(persistAttachmentFromBytes).not.toHaveBeenCalled();
  });

  test("skips images the daemon cannot read instead of failing the rewind", async () => {
    const attachments = await collectRewindImageAttachments({
      images: [historyImage("gone")],
      agentId: "agent-1",
      messageId: "msg-1",
      serverId: "server-1",
      client: failingClient(),
    });

    expect(attachments).toEqual([]);
  });

  test("collects each image of a message once", async () => {
    const attachments = await collectRewindImageAttachments({
      images: [historyImage("dup"), historyImage("dup")],
      agentId: "agent-1",
      messageId: "msg-1",
      serverId: "server-1",
      client: clientReading(new Uint8Array([9])),
    });

    expect(attachments).toHaveLength(1);
    expect(persistAttachmentFromBytes).toHaveBeenCalledTimes(1);
  });
});
