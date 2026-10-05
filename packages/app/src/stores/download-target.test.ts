import { describe, expect, it } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import type { ConnectionProbeState } from "@/utils/connection-selection";
import { resolveDaemonDownloadTarget, type HostConnectionState } from "./download-target";

const STALE_LAN: HostConnection = {
  id: "direct:10.10.10.111:6767",
  type: "directTcp",
  endpoint: "10.10.10.111:6767",
  useTls: false,
};
const PUBLIC_TLS: HostConnection = {
  id: "direct:paseo.example.com:443",
  type: "directTcp",
  endpoint: "paseo.example.com:443",
  useTls: true,
};
const RELAY: HostConnection = {
  id: "relay:relay.example.com:443",
  type: "relay",
  relayEndpoint: "relay.example.com:443",
  daemonPublicKeyB64: "key",
};

function makeHost(connections: HostConnection[]): HostProfile {
  return {
    serverId: "srv_nas",
    label: "NAS",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections,
    preferredConnectionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function state(
  activeConnectionId: string | null,
  probes: Record<string, ConnectionProbeState["status"]> = {},
): HostConnectionState {
  const probeByConnectionId = new Map<string, ConnectionProbeState>();
  for (const [id, status] of Object.entries(probes)) {
    probeByConnectionId.set(
      id,
      status === "available" ? { status, latencyMs: 12 } : { status, latencyMs: null },
    );
  }
  return { activeConnectionId, probeByConnectionId };
}

describe("resolveDaemonDownloadTarget", () => {
  it("downloads through the active connection, not a stale earlier entry", () => {
    const host = makeHost([STALE_LAN, PUBLIC_TLS]);

    expect(resolveDaemonDownloadTarget(host, state(PUBLIC_TLS.id)).baseUrl).toBe(
      "https://paseo.example.com",
    );
  });

  it("falls back to a direct connection that answered a probe", () => {
    const host = makeHost([STALE_LAN, PUBLIC_TLS, RELAY]);

    expect(
      resolveDaemonDownloadTarget(
        host,
        state(RELAY.id, { [STALE_LAN.id]: "unavailable", [PUBLIC_TLS.id]: "available" }),
      ).baseUrl,
    ).toBe("https://paseo.example.com");
  });

  it("has no target when no direct connection is active or reachable", () => {
    const host = makeHost([STALE_LAN, RELAY]);

    expect(
      resolveDaemonDownloadTarget(host, state(RELAY.id, { [STALE_LAN.id]: "unavailable" })),
    ).toEqual({ baseUrl: null, authHeader: null, authCredentials: null });
  });

  it("keeps endpoint credentials out of the URL and in a Basic header", () => {
    const host = makeHost([
      { id: "direct:user:pass@nas:6767", type: "directTcp", endpoint: "user:pass@nas:6767" },
    ]);

    expect(resolveDaemonDownloadTarget(host, state("direct:user:pass@nas:6767"))).toEqual({
      baseUrl: "http://nas:6767",
      authHeader: `Basic ${btoa("user:pass")}`,
      authCredentials: { username: "user", password: "pass" },
    });
  });
});
