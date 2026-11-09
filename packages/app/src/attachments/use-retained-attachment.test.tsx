import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import { collectRetainedAttachmentIds } from "./gc-retention";
import { useRetainedAttachment } from "./use-retained-attachment";

const { previewMetadata } = vi.hoisted(() => ({
  previewMetadata: {
    id: "preview_2249963_c15bcb86",
    mimeType: "image/jpeg",
    storageType: "desktop-file",
    storageKey: "/home/keefeere/.paseo/desktop-attachments/preview_2249963_c15bcb86.jpg",
    fileName: "preview_2249963_c15bcb86.jpg",
    byteSize: 2249963,
    createdAt: 1,
  } satisfies AttachmentMetadata,
}));

function RetentionProbe(props: { attachment: AttachmentMetadata | null }) {
  useRetainedAttachment(props.attachment);
  return null;
}

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

function mount(attachment: AttachmentMetadata | null) {
  act(() => {
    root?.render(React.createElement(RetentionProbe, { attachment }));
  });
}

describe("useRetainedAttachment", () => {
  it("keeps a preview attachment out of garbage collection while it is mounted", () => {
    mount(previewMetadata);
    expect(collectRetainedAttachmentIds()).toContain(previewMetadata.id);

    act(() => {
      root?.unmount();
    });
    expect(collectRetainedAttachmentIds()).not.toContain(previewMetadata.id);
  });

  it("releases the id when the metadata disappears and retains a replacement", () => {
    mount(previewMetadata);
    const other: AttachmentMetadata = { ...previewMetadata, id: "preview_100_abc" };

    mount(other);
    expect(collectRetainedAttachmentIds()).toContain(other.id);
    expect(collectRetainedAttachmentIds()).not.toContain(previewMetadata.id);

    mount(null);
    expect(collectRetainedAttachmentIds().size).toBe(0);
  });

  it("keeps the id while two components hold the same attachment", () => {
    function Pair() {
      useRetainedAttachment(previewMetadata);
      useRetainedAttachment(previewMetadata);
      return null;
    }
    act(() => {
      root?.render(React.createElement(Pair));
    });
    expect(collectRetainedAttachmentIds()).toContain(previewMetadata.id);

    act(() => {
      root?.unmount();
    });
    expect(collectRetainedAttachmentIds()).not.toContain(previewMetadata.id);
  });
});
