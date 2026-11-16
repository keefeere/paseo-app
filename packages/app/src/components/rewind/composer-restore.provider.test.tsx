import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import type { AttachmentUpdater } from "@/composer/draft/input-draft";
import type { ComposerTextSource } from "@/composer/text-source";
import {
  RewindComposerRestoreProvider,
  shouldRestoreComposer,
  toImageComposerAttachments,
  useRewindComposerRestore,
} from "./composer-restore";

const historyImage: AttachmentMetadata = {
  id: "preview_2249963_c15bcb86",
  mimeType: "image/jpeg",
  storageType: "desktop-file",
  storageKey: "/home/keefeere/.paseo/desktop-attachments/preview_2249963_c15bcb86.jpg",
  fileName: "preview_2249963_c15bcb86.jpg",
  byteSize: 2249963,
  createdAt: 1,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  dom.window.requestAnimationFrame = vi.fn(() => 1);
  dom.window.cancelAnimationFrame = vi.fn();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

interface RestoreApi {
  completeRewind: (input: { text: string; imageAttachments: AttachmentMetadata[] }) => void;
}

interface MountInput {
  currentText: string;
  currentAttachments: UserComposerAttachment[];
  setText: (text: string) => void;
  setAttachments: (updater: AttachmentUpdater) => void;
  onRewindComplete: () => void;
  capture: (value: RestoreApi | null) => void;
}

function mount(input: MountInput) {
  function Probe() {
    input.capture(useRewindComposerRestore());
    return null;
  }

  const textSource: ComposerTextSource = {
    getSnapshot: () => input.currentText,
    subscribe: () => () => {},
  };

  act(() => {
    root?.render(
      React.createElement(
        RewindComposerRestoreProvider,
        {
          textSource,
          setText: input.setText,
          attachments: input.currentAttachments,
          setAttachments: input.setAttachments,
          onRewindComplete: input.onRewindComplete,
        },
        React.createElement(Probe),
      ),
    );
  });
}

describe("shouldRestoreComposer", () => {
  test("restores only a composer with no text and no attachments", () => {
    expect(shouldRestoreComposer({ currentText: "", currentAttachments: [] })).toBe(true);
    expect(shouldRestoreComposer({ currentText: "drafted", currentAttachments: [] })).toBe(false);
    expect(
      shouldRestoreComposer({
        currentText: "",
        currentAttachments: [{ kind: "image", metadata: historyImage }],
      }),
    ).toBe(false);
  });
});

describe("toImageComposerAttachments", () => {
  test("wraps restored images as composer image attachments", () => {
    expect(toImageComposerAttachments([historyImage])).toEqual([
      { kind: "image", metadata: historyImage },
    ]);
  });
});

describe("RewindComposerRestoreProvider", () => {
  test("restores the text and the images of the rewound message", () => {
    const setText = vi.fn();
    const setAttachments = vi.fn();
    const onRewindComplete = vi.fn();
    let restore: RestoreApi | null = null;

    mount({
      currentText: "",
      currentAttachments: [],
      setText,
      setAttachments,
      onRewindComplete,
      capture: (value) => {
        restore = value;
      },
    });

    act(() => {
      restore?.completeRewind({ text: "check this", imageAttachments: [historyImage] });
    });

    expect(setText).toHaveBeenCalledWith("check this");
    expect(setAttachments).toHaveBeenCalledWith([{ kind: "image", metadata: historyImage }]);
    expect(onRewindComplete).toHaveBeenCalledTimes(1);
  });

  test("leaves a drafted composer untouched, including its attachments", () => {
    const setText = vi.fn();
    const setAttachments = vi.fn();
    const onRewindComplete = vi.fn();
    let restore: RestoreApi | null = null;

    mount({
      currentText: "typed while waiting",
      currentAttachments: [],
      setText,
      setAttachments,
      onRewindComplete,
      capture: (value) => {
        restore = value;
      },
    });

    act(() => {
      restore?.completeRewind({ text: "check this", imageAttachments: [historyImage] });
    });

    expect(setText).not.toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled();
    expect(onRewindComplete).toHaveBeenCalledTimes(1);
  });

  test("restores text only when the message had no images", () => {
    const setText = vi.fn();
    const setAttachments = vi.fn();
    let restore: RestoreApi | null = null;

    mount({
      currentText: "",
      currentAttachments: [],
      setText,
      setAttachments,
      onRewindComplete: () => {},
      capture: (value) => {
        restore = value;
      },
    });

    act(() => {
      restore?.completeRewind({ text: "no images here", imageAttachments: [] });
    });

    expect(setText).toHaveBeenCalledWith("no images here");
    expect(setAttachments).not.toHaveBeenCalled();
  });
});
