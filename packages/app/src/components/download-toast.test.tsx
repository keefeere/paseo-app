/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, bridge } = vi.hoisted(() => ({
  theme: {
    spacing: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16 },
    borderWidth: { 1: 1 },
    borderRadius: { lg: 8, full: 999 },
    fontSize: { sm: 13, base: 15 },
    fontWeight: { semibold: "600" },
    shadow: { md: {} },
    colors: {
      surface2: "#222",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      primary: "#4a4",
      destructive: "#f44",
    },
  },
  bridge: {
    openPath: vi.fn(async (_path: string) => {}),
    showItemInFolder: vi.fn(async (_path: string) => {}),
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  useUnistyles: () => ({ theme }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react-native", () => {
  const icon = () => null;
  return { Check: icon, X: icon, XCircle: icon };
});
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    testID: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, onClick: onPress },
      children,
    ),
}));
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => ({ opener: bridge }) }));
vi.mock("@/stores/download-store", async () => {
  const { create } = await import("zustand");
  const useDownloadStore = create<{
    downloads: Map<string, unknown>;
    activeDownloadId: string | null;
    dismissDownload: (id: string) => void;
  }>((set) => ({
    downloads: new Map(),
    activeDownloadId: null,
    dismissDownload: (id) =>
      set((state) => {
        const downloads = new Map(state.downloads);
        downloads.delete(id);
        return { downloads, activeDownloadId: null };
      }),
  }));
  return { useDownloadStore, formatSpeed: () => "", formatEta: () => "" };
});

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { useDownloadStore } from "@/stores/download-store";
import { DownloadToast } from "./download-toast";

const SAVED_PATH = "/home/user/Downloads/plan.md";

function show(download: { status: "downloading" | "complete" | "error"; savedPath?: string }) {
  const entry = { id: "d1", serverId: "s", scopeId: "w", fileName: "plan.md", ...download };
  act(() => {
    useDownloadStore.setState({
      downloads: new Map([["d1", entry]]) as never,
      activeDownloadId: "d1",
    });
  });
}

describe("DownloadToast", () => {
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge.openPath.mockClear();
    bridge.showItemInFolder.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<DownloadToast />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => {
      useDownloadStore.setState({ downloads: new Map(), activeDownloadId: null });
    });
    vi.useRealTimers();
  });

  function button(testID: string): HTMLButtonElement | null {
    return container.querySelector(`[data-testid="${testID}"]`);
  }

  it("keeps a saved file on screen with its open actions", () => {
    show({ status: "complete", savedPath: SAVED_PATH });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(container.textContent).toContain("plan.md");
    expect(button("download-open")).not.toBeNull();
    expect(button("download-show-in-folder")).not.toBeNull();
  });

  it("opens the saved file and its folder through the desktop bridge", () => {
    show({ status: "complete", savedPath: SAVED_PATH });

    act(() => button("download-open")?.click());
    act(() => button("download-show-in-folder")?.click());

    expect(bridge.openPath).toHaveBeenCalledWith(SAVED_PATH);
    expect(bridge.showItemInFolder).toHaveBeenCalledWith(SAVED_PATH);
  });

  it("says so when the system could not open the file", async () => {
    bridge.openPath.mockRejectedValueOnce(new Error("gone"));
    show({ status: "complete", savedPath: SAVED_PATH });

    await act(async () => {
      button("download-open")?.click();
    });

    expect(container.textContent).toContain("downloads.openFailed");
  });

  it("keeps a failure on screen until it is dismissed", () => {
    show({ status: "error" });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(container.textContent).toContain("plan.md");
    expect(button("download-open")).toBeNull();
  });

  it("still closes a plain completion that has nothing to act on", () => {
    show({ status: "complete" });
    expect(container.textContent).toContain("plan.md");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(container.textContent).not.toContain("plan.md");
  });
});
