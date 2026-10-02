import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type MutableRefObject,
  type ReactNode,
} from "react";
import React from "react";
import type { ToastApi } from "@/components/toast-host";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { InlinePathTarget } from "./parse";
import type { AssistantFileLinkContext, GetDirectorySuggestions } from "./resolver";

export interface AssistantFileLinkDaemonClient {
  getDirectorySuggestions: GetDirectorySuggestions;
}

export interface AssistantFileLinkResolverConfig {
  client?: AssistantFileLinkDaemonClient | null;
  serverId?: string;
  workspaceRoot?: string;
  onOpenWorkspaceFile?: (target: InlinePathTarget, disposition: OpenFileDisposition) => void;
  onOpenExternalUrl?: (url: string) => void | Promise<void>;
  toast?: ToastApi | null;
}

export interface AssistantFileLinkResolverProviderProps extends AssistantFileLinkResolverConfig {
  children: ReactNode;
}

const SystemLinkDialog = lazy(() => import("./system-link-dialog"));

export interface AssistantFileLinkResolverContextValue {
  showSystemLink: (url: string) => void;
  configRef: MutableRefObject<AssistantFileLinkResolverConfig>;
  getDirectorySuggestions: GetDirectorySuggestions;
}

const AssistantFileLinkResolverContext =
  createContext<AssistantFileLinkResolverContextValue | null>(null);

export function AssistantFileLinkResolverProvider({
  client,
  serverId,
  workspaceRoot,
  onOpenWorkspaceFile,
  onOpenExternalUrl,
  toast,
  children,
}: AssistantFileLinkResolverProviderProps) {
  const [systemLink, showSystemLink] = useState<string | null>(null);
  const closeSystemLink = useCallback(() => showSystemLink(null), []);
  const configRef = useRef<AssistantFileLinkResolverConfig>({
    client,
    serverId,
    workspaceRoot,
    onOpenWorkspaceFile,
    onOpenExternalUrl,
    toast,
  });
  configRef.current = {
    client,
    serverId,
    workspaceRoot,
    onOpenWorkspaceFile,
    onOpenExternalUrl,
    toast,
  };

  const getDirectorySuggestions = useCallback<GetDirectorySuggestions>(async (input) => {
    const activeClient = configRef.current.client;
    if (!activeClient) {
      return { entries: [], error: null };
    }

    const result = await activeClient.getDirectorySuggestions(input);
    return { entries: result.entries, error: result.error };
  }, []);

  const value = useMemo<AssistantFileLinkResolverContextValue>(
    () => ({ configRef, getDirectorySuggestions, showSystemLink }),
    [getDirectorySuggestions],
  );

  return (
    <AssistantFileLinkResolverContext.Provider value={value}>
      {children}
      {systemLink !== null ? (
        <Suspense fallback={null}>
          <SystemLinkDialog key={systemLink} url={systemLink} onClose={closeSystemLink} />
        </Suspense>
      ) : null}
    </AssistantFileLinkResolverContext.Provider>
  );
}

export function useAssistantFileLinkResolverContext(): AssistantFileLinkResolverContextValue {
  const context = useContext(AssistantFileLinkResolverContext);
  if (!context) {
    throw new Error("AssistantFileLinkResolverProvider is required for assistant file links.");
  }
  return context;
}

export type { AssistantFileLinkContext };
