import type { DirectTcpHostConnection, HostProfile } from "@/types/host-connection";
import type { ConnectionProbeState } from "@/utils/connection-selection";
import { buildDaemonWebSocketUrl } from "@/utils/daemon-endpoints";

export interface DownloadTarget {
  baseUrl: string | null;
  authHeader: string | null;
  authCredentials: { username: string; password: string } | null;
}

export interface HostConnectionState {
  activeConnectionId: string | null;
  probeByConnectionId: ReadonlyMap<string, ConnectionProbeState>;
}

const NO_TARGET: DownloadTarget = { baseUrl: null, authHeader: null, authCredentials: null };

// A host profile keeps every endpoint it was ever reached on, so its first
// directTcp entry can be stale (an old LAN address, the pre-migration local
// daemon). A download from an unreachable endpoint waits until TCP gives up.
// Use the connection the session is on, else one that answered a probe.
export function selectDownloadConnection(
  host: HostProfile,
  state: HostConnectionState | null,
): DirectTcpHostConnection | null {
  const direct = host.connections.filter(
    (connection): connection is DirectTcpHostConnection => connection.type === "directTcp",
  );
  const active = direct.find((connection) => connection.id === state?.activeConnectionId);
  if (active) return active;
  return (
    direct.find(
      (connection) => state?.probeByConnectionId.get(connection.id)?.status === "available",
    ) ?? null
  );
}

export function resolveDaemonDownloadTarget(
  host: HostProfile | undefined,
  state: HostConnectionState | null,
): DownloadTarget {
  const connection = host ? selectDownloadConnection(host, state) : null;
  if (!connection) {
    return NO_TARGET;
  }

  let parsed: URL;
  try {
    parsed = new URL(
      buildDaemonWebSocketUrl(connection.endpoint, { useTls: connection.useTls ?? false }),
    );
  } catch {
    return NO_TARGET;
  }

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }

  let authCredentials: { username: string; password: string } | null = null;
  if (parsed.username || parsed.password) {
    authCredentials = {
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
    parsed.username = "";
    parsed.password = "";
  }

  parsed.pathname = parsed.pathname.replace(/\/ws\/?$/, "/");

  const authHeader = authCredentials
    ? `Basic ${btoa(`${authCredentials.username}:${authCredentials.password}`)}`
    : null;

  return { baseUrl: parsed.origin, authHeader, authCredentials };
}
