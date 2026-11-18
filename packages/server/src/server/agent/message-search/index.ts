import { setImmediate } from "node:timers/promises";
import { langMatchRanges, scoreLangTokens } from "@getpaseo/protocol/search/lang-match";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { searchableBlocks } from "../chat-search/index.js";
import { projectTimelineRows } from "../timeline-projection.js";

const SNIPPET_RADIUS = 140;
const DEFAULT_LIMIT_PER_AGENT = 5;

export interface MessageHit {
  seq: number;
  role: "user" | "assistant";
  timestamp: string;
  /** The matched block trimmed around the first hit; `ranges` index into it. */
  snippet: string;
  ranges: { start: number; length: number }[];
  /** Sum of the per-token tiers; lower matched closer. */
  score: number;
}

/**
 * Language-tolerant match over one message's rendered text.
 *
 * Stems and typos make `який максимально` find `яка максимально` and `рендері` find
 * `рендер`, which is how people actually recall a conversation. Word order is free, so a
 * query assembled from memory lands even when the message said the words the other way round.
 */
export function matchMessageText(
  query: string,
  blocks: readonly string[],
): { score: number; block: string; ranges: { start: number; length: number }[] } | null {
  let best: { score: number; block: string; ranges: { start: number; length: number }[] } | null =
    null;
  for (const block of blocks) {
    const score = scoreLangTokens(query, [block]);
    if (!score) continue;
    if (!best || score.tier < best.score) {
      best = { score: score.tier, block, ranges: langMatchRanges(query, block) };
    }
  }
  return best;
}

/** Cut a snippet around the first marked range, collapsing newlines so one row stays one row. */
function buildSnippet(block: string, ranges: { start: number; length: number }[]): string {
  const first = ranges[0]?.start ?? 0;
  const start = Math.max(0, first - SNIPPET_RADIUS);
  const end = Math.min(block.length, first + SNIPPET_RADIUS);
  const text = block.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < block.length ? "…" : ""}`;
}

/**
 * Hits in one agent's timeline, best match first. Markdown is searched block by block for the
 * same reason `chat-search` does: a hit the client cannot highlight inflates the result.
 * Yields periodically so a long transcript does not hold the event loop.
 */
export async function searchAgentMessages(
  rows: readonly AgentTimelineRow[],
  query: string,
  options?: { limit?: number; deadline?: number },
): Promise<{ hits: MessageHit[]; exhausted: boolean }> {
  const trimmed = query.trim();
  const limit = options?.limit ?? DEFAULT_LIMIT_PER_AGENT;
  if (!trimmed) return { hits: [], exhausted: true };

  const hits: MessageHit[] = [];
  let lastYield = performance.now();
  for (const entry of projectTimelineRows({ rows, mode: "projected" })) {
    if (options?.deadline !== undefined && performance.now() >= options.deadline) {
      await setImmediate();
      return { hits, exhausted: false };
    }
    const item = entry.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    const raw = item.text.replace(/\r/g, "");
    const blocks = item.type === "assistant_message" ? searchableBlocks(raw) : [raw];
    const match = matchMessageText(trimmed, blocks);
    if (match) {
      hits.push({
        seq: entry.seqEnd,
        role: item.type === "user_message" ? "user" : "assistant",
        timestamp: entry.timestamp,
        snippet: buildSnippet(match.block, match.ranges),
        ranges: match.ranges,
        score: match.score,
      });
      hits.sort((a, b) => a.score - b.score);
      if (hits.length > limit) hits.length = limit;
    }
    if (performance.now() - lastYield >= 8) {
      await setImmediate();
      lastYield = performance.now();
    }
  }
  return { hits, exhausted: true };
}
