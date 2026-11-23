import { useAppSettings } from "@/hooks/use-settings";
import { resolveWorkspaceTargetPlacement } from "@/workspace-tabs/open-beside";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useMemo } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { createPluginHostNavigation } from "./host-navigation-model";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

export function usePluginHostNavigation(
  serverId: string,
): NonNullable<PluginSurfaceProps["navigation"]> {
  const terminalOnSide = useAppSettings().settings.openInSidePane.terminals;
  return useMemo(
    () =>
      createPluginHostNavigation(serverId, {
        browserAvailable: getIsElectron(),
        isHostRegistered: (targetServerId) =>
          getHostRuntimeStore()
            .getHosts()
            .some((host) => host.serverId === targetServerId),
        openAgent: navigateToAgent,
        openTerminal: ({ serverId: targetServerId, workspaceId, terminalId }) => {
          const target = { kind: "terminal" as const, terminalId };
          const placement = resolveWorkspaceTargetPlacement({
            workspaceKey: `${targetServerId}:${workspaceId}`,
            target,
            location: terminalOnSide ? "side" : "main",
          });
          navigateToWorkspace({ serverId: targetServerId, workspaceId, target, placement });
        },
        openWorkspace: navigateToWorkspace,
        createBrowser: createWorkspaceBrowser,
        focusHost: (targetServerId) => useSidebarViewStore.getState().focusHost(targetServerId),
        resolveWorkspace: ({ serverId: targetServerId, workspaceId }) =>
          resolveWorkspaceMapKeyByIdentity({
            workspaces: useSessionStore.getState().sessions[targetServerId]?.workspaces,
            workspaceId,
          }),
      }),
    [serverId, terminalOnSide],
  );
}
