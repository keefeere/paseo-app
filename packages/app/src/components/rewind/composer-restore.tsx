import type { ComposerTextSource } from "@/composer/text-source";
import type { AttachmentUpdater } from "@/composer/draft/input-draft";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

interface RewindComposerRestoreContextValue {
  completeRewind: (input: RewindRestoreInput) => void;
}

interface RewindRestoreInput {
  text: string;
  imageAttachments: AttachmentMetadata[];
}

interface RewindComposerRestoreProviderProps {
  textSource: ComposerTextSource;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  onRewindComplete: () => void;
  children?: ReactNode;
}

const RewindComposerRestoreContext = createContext<RewindComposerRestoreContextValue | null>(null);

export function restoreComposerTextIfEmpty(input: {
  currentText: string;
  rewoundText: string;
}): string {
  if (input.currentText.length > 0) {
    return input.currentText;
  }
  return input.rewoundText;
}

/**
 * A rewind restores the whole message, so anything already in the composer — text or attachments —
 * wins and the rewound message is left alone.
 */
export function shouldRestoreComposer(input: {
  currentText: string;
  currentAttachments: UserComposerAttachment[];
}): boolean {
  return input.currentText.length === 0 && input.currentAttachments.length === 0;
}

export function toImageComposerAttachments(images: AttachmentMetadata[]): UserComposerAttachment[] {
  return images.map((metadata) => ({ kind: "image", metadata }));
}

export function RewindComposerRestoreProvider({
  textSource,
  setText,
  attachments,
  setAttachments,
  onRewindComplete,
  children,
}: RewindComposerRestoreProviderProps) {
  const completeRewind = useCallback(
    (rewindInput: RewindRestoreInput) => {
      const currentText = textSource.getSnapshot();
      if (shouldRestoreComposer({ currentText, currentAttachments: attachments })) {
        if (rewindInput.text.length > 0) {
          setText(rewindInput.text);
        }
        if (rewindInput.imageAttachments.length > 0) {
          setAttachments(toImageComposerAttachments(rewindInput.imageAttachments));
        }
      }
      onRewindComplete();
    },
    [attachments, onRewindComplete, setAttachments, setText, textSource],
  );

  const value = useMemo(() => ({ completeRewind }), [completeRewind]);

  return (
    <RewindComposerRestoreContext.Provider value={value}>
      {children}
    </RewindComposerRestoreContext.Provider>
  );
}

export function useRewindComposerRestore(): RewindComposerRestoreContextValue | null {
  return useContext(RewindComposerRestoreContext);
}
