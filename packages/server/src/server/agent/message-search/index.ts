import { setImmediate } from "node:timers/promises";
import { langMatchRanges, scoreLangTokens, stemToken } from "@getpaseo/protocol/search/lang-match";
import { boundedEditDistance } from "@getpaseo/protocol/search/text-match";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { searchableBlocks } from "../chat-search/index.js";

const SNIPPET_RADIUS = 140;
const DEFAULT_LIMIT_PER_AGENT = 5;
/** Agents whose extracted text and vocabulary are kept between searches. */
const MAX_CACHED_AGENTS = 24;
/** Typo tier: the same bound `lang-match` uses, so the index never proposes a word the scorer
 *  would reject for a shorter word pair. */
const MAX_WORD_EDITS = 2;
const WORD_PATTERN = /[\p{L}\p{N}'’]+/gu;

interface SearchableMessage {
  seq: number;
  role: "user" | "assistant";
  timestamp: string;
  blocks: string[];
  /** Same blocks lowercased, for exact substring search. Offsets line up with `blocks`.
   *  `toLowerCase()` preserves length for the scripts chat text is written in. */
  lowerBlocks: string[];
}

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
 * The searchable text of a timeline, in transcript order.
 *
 * This deliberately avoids `projectTimelineRows`: search needs neither tool collapsing nor
 * reasoning merges. Consecutive assistant chunks of one turn are joined so a hit is reported once
 * with the whole answer, and `seq` is the last row of the message — the position the chat jumps to.
 */
export function buildSearchableMessages(rows: readonly AgentTimelineRow[]): SearchableMessage[] {
  const messages: SearchableMessage[] = [];
  let openAssistant: { turnId?: string; chunks: string[]; seq: number; timestamp: string } | null =
    null;

  const flush = () => {
    if (!openAssistant) return;
    const raw = openAssistant.chunks.join("").replace(/\r/g, "");
    const blocks = searchableBlocks(raw);
    messages.push({
      seq: openAssistant.seq,
      role: "assistant",
      timestamp: openAssistant.timestamp,
      blocks,
      lowerBlocks: blocks.map((block) => block.toLowerCase()),
    });
    openAssistant = null;
  };

  for (const row of rows) {
    const item = row.item;
    if (item.type === "user_message") {
      flush();
      const text = item.text.replace(/\r/g, "");
      messages.push({
        seq: row.seq,
        role: "user",
        timestamp: row.timestamp,
        blocks: [text],
        lowerBlocks: [text.toLowerCase()],
      });
      continue;
    }
    if (item.type !== "assistant_message") {
      continue;
    }
    const turnId = row.turnId;
    if (openAssistant && (turnId === undefined || openAssistant.turnId === turnId)) {
      openAssistant.chunks.push(item.text);
      openAssistant.seq = row.seq;
      openAssistant.timestamp = row.timestamp;
      continue;
    }
    flush();
    openAssistant = { turnId, chunks: [item.text], seq: row.seq, timestamp: row.timestamp };
  }
  flush();
  return messages;
}

/**
 * Per-agent inverted word index over the searchable messages.
 *
 * Scoring every message of a long transcript costs seconds per keystroke, which is why a scan
 * under a time budget reports "no matches" on a host with dozens of chats. The index is built once
 * per `(agent, epoch)` and answers a query from postings, then re-scores only the surviving
 * messages, so `scoreLangTokens` stays the single source of truth for tiers and highlight ranges.
 */
interface AgentMessageIndex {
  epoch: string;
  count: number;
  lastSeq: number;
  messages: SearchableMessage[];
  /** Word → messages containing it, and stem → the same. */
  postings: Map<string, Set<number>>;
  words: string[];
  /** Token → message ids, memoized because the vocabulary is stable while the user types. */
  expanded: Map<string, Set<number>>;
}

function addPosting(postings: Map<string, Set<number>>, key: string, messageId: number): void {
  const existing = postings.get(key);
  if (existing) {
    existing.add(messageId);
    return;
  }
  postings.set(key, new Set([messageId]));
}

function buildAgentMessageIndex(
  agentId: string,
  epoch: string,
  rows: readonly AgentTimelineRow[],
): AgentMessageIndex {
  void agentId;
  const messages = buildSearchableMessages(rows);
  const postings = new Map<string, Set<number>>();
  const seenWords = new Set<string>();

  messages.forEach((message, messageId) => {
    for (const block of message.blocks) {
      const words = block.match(WORD_PATTERN);
      if (!words) continue;
      for (const rawWord of words) {
        const word = rawWord.toLowerCase();
        addPosting(postings, word, messageId);
        const stem = stemToken(word);
        if (stem !== word) addPosting(postings, stem, messageId);
        seenWords.add(word);
      }
    }
  });

  return {
    epoch,
    count: rows.length,
    lastSeq: rows.length > 0 ? (rows[rows.length - 1]?.seq ?? 0) : 0,
    messages,
    postings,
    words: [...seenWords],
    expanded: new Map(),
  };
}

/**
 * Messages that could hold `token`: exact, prefix either way, substring inside a longer word, or
 * within the typo budget. Everything here is only a candidate list — the scorer decides.
 */
function expandToken(index: AgentMessageIndex, token: string): Set<number> {
  const cached = index.expanded.get(token);
  if (cached) return cached;

  const found = new Set<number>();
  const stem = stemToken(token);
  for (const key of [token, stem]) {
    const posting = index.postings.get(key);
    if (posting) {
      for (const messageId of posting) found.add(messageId);
    }
  }

  for (const word of index.words) {
    const cheap =
      word.startsWith(token) ||
      token.startsWith(word) ||
      word.includes(token) ||
      word.includes(stem) ||
      stem.includes(word);
    if (!cheap) continue;
    const posting = index.postings.get(word);
    if (posting) {
      for (const messageId of posting) found.add(messageId);
    }
  }

  // The typo tier is the expensive pass (bounded edit distance over the whole vocabulary), so it
  // runs only when nothing else matched — a miss is usually a miss, and a hit is already found.
  if (found.size === 0) {
    for (const word of index.words) {
      const distance = boundedEditDistance(token, word, MAX_WORD_EDITS);
      if (distance === null || distance > MAX_WORD_EDITS) continue;
      const posting = index.postings.get(word);
      if (posting) {
        for (const messageId of posting) found.add(messageId);
      }
    }
  }

  index.expanded.set(token, found);
  return found;
}

/** How many candidate messages one agent's query scores. A query that matches the whole
 *  transcript is scored newest first and cut here, so the answer stays interactive; `exhausted`
 *  then reports the scan was not complete. */
const CANDIDATE_SCORE_BUDGET = 1500;
/** Highlights per message in exact mode; a query like `250` occurs hundreds of times. */
const MAX_EXACT_RANGES = 40;

/** Every occurrence of `needle` in the lowercased block, capped. */
function findAllRanges(lower: string, needle: string): { start: number; length: number }[] {
  const ranges: { start: number; length: number }[] = [];
  let at = lower.indexOf(needle);
  while (at >= 0 && ranges.length < MAX_EXACT_RANGES) {
    ranges.push({ start: at, length: needle.length });
    at = lower.indexOf(needle, at + needle.length);
  }
  return ranges;
}

/**
 * Exact substring hits, newest first.
 *
 * Numeric and identifier queries (`250 Bq`, `0.16.2-beta.905`) are where the fuzzy tiers hurt:
 * a digit run stems and typo-matches into every message that contains digits. Exact mode answers
 * with the literal text, ignoring case only. Every hit scores the same, so the newest matches are
 * the ones kept.
 */
function searchExact(
  index: AgentMessageIndex,
  query: string,
  options: { limit: number; deadline?: number },
): { hits: MessageHit[]; exhausted: boolean } {
  const needle = query.toLowerCase();
  if (!needle) return { hits: [], exhausted: true };
  const hits: MessageHit[] = [];
  for (let messageId = index.messages.length - 1; messageId >= 0; messageId -= 1) {
    if (options.deadline !== undefined && performance.now() >= options.deadline) {
      return { hits, exhausted: false };
    }
    const message = index.messages[messageId];
    if (!message) continue;
    for (let blockIndex = 0; blockIndex < message.blocks.length; blockIndex += 1) {
      const lower = message.lowerBlocks[blockIndex];
      if (!lower || !lower.includes(needle)) continue;
      const ranges = findAllRanges(lower, needle);
      const block = message.blocks[blockIndex] ?? "";
      hits.push({
        seq: message.seq,
        role: message.role,
        timestamp: message.timestamp,
        snippet: buildSnippet(block, ranges),
        ranges,
        score: 0,
      });
      break;
    }
    if (hits.length >= options.limit) return { hits, exhausted: false };
  }
  return { hits, exhausted: true };
}

function collectCandidates(index: AgentMessageIndex, tokens: string[]): number[] {
  const sets = tokens.map((token) => expandToken(index, token));
  if (sets.some((set) => set.size === 0)) return [];
  sets.sort((left, right) => left.size - right.size);
  const [smallest, ...rest] = sets;
  if (!smallest) return [];
  // Newest transcripts are the ones people recall, so truncation keeps the recent matches.
  return [...smallest]
    .filter((messageId) => rest.every((set) => set.has(messageId)))
    .sort((left, right) => right - left);
}

/**
 * How a query is matched against message text.
 *
 * `fuzzy` is stem and typo tolerant, which is what people want when they recall a conversation.
 * `exact` is a literal substring, which is what they want for numbers and identifiers.
 */
export type MessageSearchMode = "fuzzy" | "exact";

interface SearchOptions {
  limit?: number;
  deadline?: number;
  /** Defaults to `fuzzy`. */
  mode?: MessageSearchMode;
}

/** Hits in one agent's index, best match first. Stops on the deadline and reports `exhausted`. */
function searchIndex(
  index: AgentMessageIndex,
  query: string,
  options: { limit: number; deadline?: number; mode: MessageSearchMode },
): { hits: MessageHit[]; exhausted: boolean } {
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], exhausted: true };
  if (options.mode === "exact") {
    return searchExact(index, trimmed, options);
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { hits: [], exhausted: true };

  const candidates = collectCandidates(index, tokens);
  const scored = candidates.slice(0, CANDIDATE_SCORE_BUDGET);
  const truncated = candidates.length > scored.length;
  const hits: MessageHit[] = [];
  for (const messageId of scored) {
    if (options.deadline !== undefined && performance.now() >= options.deadline) {
      return { hits, exhausted: false };
    }
    const message = index.messages[messageId];
    if (!message) continue;
    const match = matchMessageText(trimmed, message.blocks);
    if (!match) continue;
    hits.push({
      seq: message.seq,
      role: message.role,
      timestamp: message.timestamp,
      snippet: buildSnippet(match.block, match.ranges),
      ranges: match.ranges,
      score: match.score,
    });
    hits.sort((a, b) => a.score - b.score);
    if (hits.length > options.limit) hits.length = options.limit;
  }
  return { hits, exhausted: !truncated };
}

/** Hits in one agent's timeline rows. Builds the index for the rows when none is cached. */
export async function searchAgentMessages(
  rows: readonly AgentTimelineRow[],
  query: string,
  options?: SearchOptions,
): Promise<{ hits: MessageHit[]; exhausted: boolean }> {
  await setImmediate();
  const index = buildAgentMessageIndex("", "scan", rows);
  return searchIndex(index, query, {
    limit: options?.limit ?? DEFAULT_LIMIT_PER_AGENT,
    deadline: options?.deadline,
    mode: options?.mode ?? "fuzzy",
  });
}

const cache = new Map<string, AgentMessageIndex>();
const cacheOrder: string[] = [];

function remember(agentId: string, index: AgentMessageIndex): void {
  const at = cacheOrder.indexOf(agentId);
  if (at >= 0) cacheOrder.splice(at, 1);
  cacheOrder.push(agentId);
  cache.set(agentId, index);
  while (cacheOrder.length > MAX_CACHED_AGENTS) {
    const oldest = cacheOrder.shift();
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Rough rows-per-millisecond throughput of index building, used to decide whether an agent can
 *  still be indexed inside the request budget. Tuned on a 20k-row transcript (~2s). */
const INDEX_ROWS_PER_MS = 10;

/** Whether a cached index for `agentId` is still valid at this timeline head, so the caller can
 *  skip reading the transcript at all. */
export function isMessageSearchIndexFresh(
  agentId: string,
  epoch: string,
  lastSeq: number,
): boolean {
  const cached = cache.get(agentId);
  return Boolean(cached && cached.epoch === epoch && cached.lastSeq === lastSeq);
}

/**
 * Hits in one agent, reusing its index while the timeline head is unchanged.
 *
 * Timeline rows are append-only within an epoch, so an unchanged `(epoch, lastSeq)` means nothing
 * was added, replaced, or reset: a re-typed query is a posting lookup, not a transcript read.
 * Pass `rows` as `undefined` when the caller already knows the index is fresh; a reload or
 * timeline replacement changes the epoch and rebuilds the index.
 */
export async function searchCachedAgentMessages(
  agentId: string,
  epoch: string,
  rows: readonly AgentTimelineRow[] | undefined,
  query: string,
  options?: SearchOptions,
): Promise<{ hits: MessageHit[]; exhausted: boolean }> {
  const cached = cache.get(agentId);
  let index: AgentMessageIndex;
  if (rows === undefined) {
    if (!cached || cached.epoch !== epoch) return { hits: [], exhausted: true };
    index = cached;
  } else {
    const lastSeq = rows.length > 0 ? (rows[rows.length - 1]?.seq ?? 0) : 0;
    if (
      cached &&
      cached.epoch === epoch &&
      cached.count === rows.length &&
      cached.lastSeq === lastSeq
    ) {
      index = cached;
    } else {
      index = buildAgentMessageIndex(agentId, epoch, rows);
      remember(agentId, index);
    }
  }
  return searchIndex(index, query, {
    limit: options?.limit ?? DEFAULT_LIMIT_PER_AGENT,
    deadline: options?.deadline,
    mode: options?.mode ?? "fuzzy",
  });
}

/** Drop one agent's index and any queued warm task. */
export function invalidateMessageSearchCache(agentId: string): void {
  cache.delete(agentId);
  const at = warmQueue.findIndex((task) => task.agentId === agentId);
  if (at >= 0) warmQueue.splice(at, 1);
}

/** Cache an index built outside the request path. */
export function rememberMessageSearchIndex(
  agentId: string,
  epoch: string,
  rows: readonly AgentTimelineRow[],
): void {
  remember(agentId, buildAgentMessageIndex(agentId, epoch, rows));
}

interface WarmTask {
  agentId: string;
  build: () => Promise<{ epoch: string; rows: readonly AgentTimelineRow[] } | null>;
}

const warmQueue: WarmTask[] = [];
let warmRunning = false;

async function runWarmQueue(): Promise<void> {
  if (warmRunning) return;
  warmRunning = true;
  try {
    while (warmQueue.length > 0) {
      const task = warmQueue.shift();
      if (!task) break;
      try {
        const built = await task.build();
        if (built) rememberMessageSearchIndex(task.agentId, built.epoch, built.rows);
      } catch {
        // A transcript that cannot be read now is retried by the next search that asks for it.
      }
      await setImmediate();
    }
  } finally {
    warmRunning = false;
  }
}

/**
 * Build an agent's index off the request path.
 * One warm loop runs at a time, one agent per tick, so typing stays responsive while the host
 * warms the transcripts the last search could not afford to index.
 */
export function queueMessageSearchIndexWarm(task: WarmTask): void {
  if (warmQueue.some((queued) => queued.agentId === task.agentId)) return;
  if (cache.has(task.agentId)) return;
  warmQueue.push(task);
  void runWarmQueue();
}

/** Whether an agent already holds an index, whatever its head. */
export function hasMessageSearchIndex(agentId: string): boolean {
  return cache.has(agentId);
}

/** How long indexing `rowCount` rows is expected to take. */
export function estimatedIndexCostMs(rowCount: number): number {
  return Math.ceil(rowCount / INDEX_ROWS_PER_MS);
}
