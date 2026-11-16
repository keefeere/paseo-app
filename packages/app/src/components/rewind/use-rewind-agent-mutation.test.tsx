import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import type { UserMessageImage } from "@/types/stream";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useRewindAgentMutation } from "./use-rewind-agent-mutation";

const order = vi.hoisted(() => ({ steps: [] as string[] }));
const collectRewindImageAttachments = vi.hoisted(() =>
  vi.fn(async () => {
    order.steps.push("collect");
    return [historyImage] as AttachmentMetadata[];
  }),
);
const completeRewind = vi.hoisted(() => vi.fn());
const fetchAgentTimeline = vi.hoisted(() =>
  vi.fn(async () => {
    order.steps.push("timeline");
  }),
);

vi.mock("./rewind-image-attachments", () => ({ collectRewindImageAttachments }));
vi.mock("./composer-restore", () => ({
  useRewindComposerRestore: () => ({ completeRewind }),
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: {} }) },
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ fetchAgentTimeline }),
}));

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
let queryClient: QueryClient | null = null;

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
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  root = createRoot(container);
  order.steps = [];
  completeRewind.mockClear();
  fetchAgentTimeline.mockClear();
  collectRewindImageAttachments.mockClear();
});

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  // react-query batches listener notifications on a timer; flush them while the DOM globals are
  // still stubbed, otherwise the callback lands after teardown and reads `window`.
  await new Promise((resolve) => setTimeout(resolve, 0));
  root = null;
  container?.remove();
  container = null;
  queryClient = null;
  vi.unstubAllGlobals();
});

function clientRecording(): DaemonClient {
  return {
    rewindAgent: async () => {
      order.steps.push("rewind");
    },
  } as unknown as DaemonClient;
}

type RewindCaller = (input: {
  mode: "conversation" | "files" | "both";
  rewoundText: string;
  images?: UserMessageImage[];
}) => Promise<void>;

let captured: RewindCaller | null = null;

async function runRewind(input: {
  client: DaemonClient;
  mode: "conversation" | "files" | "both";
  images?: UserMessageImage[];
}) {
  function HookProbe() {
    const mutation = useRewindAgentMutation({
      serverId: "server-1",
      agentId: "agent-1",
      messageId: "msg-1",
      client: input.client,
      workspaceRoot: "/workspace",
    });
    captured = mutation.rewindAgent;
    return null;
  }
  act(() => {
    root?.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient as QueryClient },
        React.createElement(HookProbe),
      ),
    );
  });
  await act(async () => {
    await captured?.({
      mode: input.mode,
      rewoundText: "check this",
      images: input.images,
    });
  });
}

describe("useRewindAgentMutation", () => {
  test("copies history images before the daemon rewinds the conversation", async () => {
    await runRewind({
      client: clientRecording(),
      mode: "conversation",
      images: [{ id: "c15bcb86", mimeType: "image/jpeg", source: "/home/keefeere/img.jpg" }],
    });

    expect(order.steps).toEqual(["collect", "rewind", "timeline"]);
    expect(completeRewind).toHaveBeenCalledWith({
      text: "check this",
      imageAttachments: [historyImage],
    });
  });

  test("does not copy images for a files-only rewind", async () => {
    await runRewind({
      client: clientRecording(),
      mode: "files",
      images: [{ id: "c15bcb86", mimeType: "image/jpeg", source: "/home/keefeere/img.jpg" }],
    });

    expect(order.steps).toEqual(["rewind"]);
    expect(collectRewindImageAttachments).not.toHaveBeenCalled();
    expect(completeRewind).not.toHaveBeenCalled();
  });
});
