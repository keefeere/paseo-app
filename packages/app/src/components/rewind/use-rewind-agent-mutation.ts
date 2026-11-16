import { planTimelineTailFetch } from "@/timeline/timeline-sync-plan";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { AttachmentMetadata } from "@/attachments/types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { UserMessageImage } from "@/types/stream";
import type { RewindMode } from "./use-rewind-capabilities";
import { useRewindComposerRestore } from "./composer-restore";
import { collectRewindImageAttachments } from "./rewind-image-attachments";
import { useSessionStore } from "@/stores/session-store";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

interface UseRewindAgentMutationInput {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  client?: DaemonClient | null;
  workspaceRoot?: string;
}

interface RewindAgentInput {
  mode: RewindMode;
  rewoundText: string;
  images?: UserMessageImage[];
}

export function useRewindAgentMutation(input: UseRewindAgentMutationInput): {
  rewindAgent: (input: RewindAgentInput) => Promise<void>;
  isPending: boolean;
} {
  const toast = useToast();
  const { t } = useTranslation();
  const composerRestore = useRewindComposerRestore();
  const { isPending, mutateAsync } = useMutation<AttachmentMetadata[], Error, RewindAgentInput>({
    mutationFn: async ({ mode, images }) => {
      if (!input.client || !input.agentId || !input.messageId) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      // The daemon garbage-collects conversation images that no timeline row references, and the
      // rewound row is exactly the one that carries them. Copy them locally while it still exists.
      const imageAttachments =
        mode === "files"
          ? []
          : await collectRewindImageAttachments({
              images: images ?? [],
              agentId: input.agentId,
              messageId: input.messageId,
              serverId: input.serverId,
              client: input.client,
              workspaceRoot: input.workspaceRoot,
            });
      await input.client.rewindAgent(input.agentId, input.messageId, mode);
      if (mode !== "files") {
        const cursor = input.serverId
          ? useSessionStore
              .getState()
              .sessions[input.serverId]?.agentTimelineCursor.get(input.agentId)
          : undefined;
        if (!input.serverId) throw new Error(t("common.errors.daemonClientUnavailable"));
        await getHostRuntimeStore().fetchAgentTimeline(input.serverId, input.agentId, {
          ...planTimelineTailFetch(),
          ...(cursor ? { cursor: { epoch: cursor.epoch, seq: cursor.endSeq } } : {}),
        });
      }
      return imageAttachments;
    },
    onSuccess: (imageAttachments, variables) => {
      if (!shouldRestoreComposerForRewindMode(variables.mode)) {
        return;
      }
      composerRestore?.completeRewind({
        text: variables.rewoundText,
        imageAttachments,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("rewind.errors.failed"));
    },
  });

  const rewindAgent = useCallback(
    async (rewindInput: RewindAgentInput) => {
      if (isPending) {
        return;
      }
      await mutateAsync(rewindInput);
    },
    [isPending, mutateAsync],
  );

  return {
    rewindAgent,
    isPending,
  };
}
