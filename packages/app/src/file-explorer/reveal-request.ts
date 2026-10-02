import { create } from "zustand";

export interface ExplorerRevealRequest {
  id: number;
  /** Explorer entry path relative to the workspace root; "." is the root. */
  path: string;
}

interface ExplorerRevealState {
  requests: Record<string, ExplorerRevealRequest>;
  request: (key: string, path: string) => void;
  complete: (key: string, id: number) => void;
}

let nextRequestId = 0;

/**
 * One-shot reveal requests for mounted or not-yet-mounted explorers. Not persisted:
 * a reveal that outlives the app session would expand folders the user never asked for.
 */
export const useExplorerRevealStore = create<ExplorerRevealState>()((set) => ({
  requests: {},
  request: (key, path) =>
    set((state) => ({
      requests: { ...state.requests, [key]: { id: ++nextRequestId, path } },
    })),
  complete: (key, id) =>
    set((state) => {
      if (state.requests[key]?.id !== id) return state;
      const { [key]: _completed, ...requests } = state.requests;
      return { requests };
    }),
}));

export function buildExplorerRevealKey(serverId: string, explorerStateKey: string): string {
  return `${serverId}\u0000${explorerStateKey}`;
}

/** Directories to expand so `path` and its children are visible, outermost first. */
export function explorerRevealDirectories(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment && segment !== ".");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}
