import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessagesSearchPayload } from "@getpaseo/client/internal/daemon-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/** Command Center debounces its file search at 100ms; transcripts take longer to read. */
const MESSAGE_SEARCH_DEBOUNCE_MS = 300;
const MESSAGE_SEARCH_PAGE_LIMIT = 40;
/** Pages per host per query. The host walks its agents one page at a time under a time budget. */
const MESSAGE_SEARCH_MAX_PAGES = 3;

export interface MessageSearchHit {
  serverId: string;
  agentId: string;
  agentTitle: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  projectName: string | null;
  branch: string | null;
  cwd: string;
  archived: boolean;
  epoch: string;
  seq: number;
  role: "user" | "assistant";
  occurredAt: string | null;
  snippet: string;
  ranges: { start: number; length: number }[];
  score: number;
}

function withHostIdentity(
  serverId: string,
  payload: AgentMessagesSearchPayload,
): MessageSearchHit[] {
  return payload.hits.map((hit) => ({ serverId, ...hit }));
}

function sortHits(hits: readonly MessageSearchHit[]): MessageSearchHit[] {
  return [...hits].sort(
    (left, right) =>
      left.score - right.score ||
      Date.parse(right.occurredAt ?? "0") - Date.parse(left.occurredAt ?? "0"),
  );
}

function searchMessagePage(
  serverId: string,
  query: string,
  cursor: number | undefined,
): Promise<AgentMessagesSearchPayload> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) return Promise.reject(new Error("Host disconnected"));
  return client.searchAgentMessages({
    query,
    cursor,
    includeArchived: true,
    limit: MESSAGE_SEARCH_PAGE_LIMIT,
  });
}

/**
 * Walk one host until it runs out of agents, the page budget is spent, or it stops finding
 * enough to be worth another round trip. Pages are handed back as they arrive: a host that needs
 * tens of seconds to scan its chats should show the first hits, not a spinner.
 */
async function searchHost(
  serverId: string,
  query: string,
  onPage: (hits: MessageSearchHit[]) => void,
): Promise<MessageSearchHit[]> {
  const hits: MessageSearchHit[] = [];
  let cursor: number | null | undefined;
  for (let page = 0; page < MESSAGE_SEARCH_MAX_PAGES; page += 1) {
    const payload = await searchMessagePage(serverId, query, cursor ?? undefined);
    const pageHits = withHostIdentity(serverId, payload);
    hits.push(...pageHits);
    onPage(pageHits);
    cursor = payload.nextCursor;
    if (cursor === null || hits.length >= MESSAGE_SEARCH_PAGE_LIMIT) break;
  }
  return hits;
}

interface MessageSearchState {
  requestKey: string | null;
  hits: MessageSearchHit[];
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: MessageSearchState = { requestKey: null, hits: [], loading: false, error: null };

/**
 * Message text across every chat on every host that advertises `messageSearch`.
 *
 * Gated on the capability: a host without it contributes nothing rather than a partial answer
 * assembled from other RPCs. Hosts are searched in parallel; one failing host is reported and
 * the rest still answer.
 */
export function useMessageSearch(input: { enabled: boolean; query: string }): {
  hits: readonly MessageSearchHit[];
  loading: boolean;
  error: string | null;
} {
  const trimmed = input.query.trim();
  const sessions = useSessionStore((state) => state.sessions);
  const serverIds = useMemo(
    () =>
      Object.keys(sessions).filter(
        (serverId) =>
          sessions[serverId]?.serverInfo?.features?.messageSearch === true &&
          getHostRuntimeStore().getClient(serverId) !== null,
      ),
    [sessions],
  );
  const requestKey = useMemo(
    () => (input.enabled && trimmed ? `${trimmed}\0${serverIds.join(",")}` : null),
    [input.enabled, serverIds, trimmed],
  );
  const [state, setState] = useState<MessageSearchState>(EMPTY_STATE);
  // Hosts churn as agents update; the request key already encodes the host set, so the
  // effect reads the list through a ref instead of depending on the array's identity.
  const serverIdsRef = useRef<string[]>(serverIds);
  serverIdsRef.current = serverIds;

  useEffect(() => {
    if (!requestKey) {
      setState(EMPTY_STATE);
      return;
    }
    setState({ ...EMPTY_STATE, requestKey, loading: true });
    const hosts = serverIdsRef.current;

    let cancelled = false;
    const collect = async (): Promise<void> => {
      const collected: MessageSearchHit[] = [];
      let error: string | null = null;
      const publish = (): void => {
        if (cancelled) return;
        setState({
          requestKey,
          hits: sortHits(collected),
          loading: true,
          error,
        });
      };
      const settled = await Promise.allSettled(
        hosts.map((serverId) =>
          searchHost(serverId, trimmed, (pageHits) => {
            collected.push(...pageHits);
            publish();
          }),
        ),
      );
      if (cancelled) return;
      settled.forEach((result, index) => {
        if (result.status === "rejected") {
          error = error ?? `${hosts[index]}: ${String(result.reason)}`;
          return;
        }
      });
      setState({ requestKey, hits: sortHits(collected), loading: false, error });
    };
    const timer = setTimeout(() => {
      void collect();
    }, MESSAGE_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [requestKey, trimmed]);

  return {
    hits: requestKey && state.requestKey === requestKey ? state.hits : [],
    loading: Boolean(requestKey) && (state.requestKey !== requestKey || state.loading),
    error: requestKey && state.requestKey === requestKey ? state.error : null,
  };
}
