---
name: paseo-search
description: Search across chat transcripts — current and past agents — when you've lost a detail in context or need to find where something was said. Use when the user asks to find something in a previous conversation, recall a decision, or recover a detail that isn't in the current context.
user-invocable: true
argument-hint: "<query>"
---

# Paseo Search

Recall a detail from across chat transcripts. The agent has no transcript memory after compaction; the daemon does.

## Prerequisites

Read the **paseo** skill. The tool is `search_messages` in the Paseo tool catalog.

## Using the tool

Call `search_messages` with the `query` as the user's request. Options:

- `mode: "exact"` — literal substring, case-insensitive, order preserved. Use for identifiers, numbers, symbols (`250 Bq`, `v0.16.2-beta.905`, file paths).
- `mode: "fuzzy"` (default) — stemmed / language-tolerant match. Use for ordinary words, especially non-English text.
- `agentId` — search just one chat when the user names it.
- `cwd` — scope to an agent's working directory. Defaults to the caller agent's cwd when agent-scoped; otherwise searches everything.
- `limit` (default 5) — max hits per agent.
- `sinceHours` (default 48) — only search recent chats. Widen it when the user asks about an older topic.
- `includeArchived` — include archived agents (default false).

Results are capped at 40 hits total, sorted best-first. Each hit carries `agentId`, `agentTitle`, `cwd`, `role`, `snippet`, `score`, `timestamp`.

## After a hit

The snippet is the match window; read the agent's actual transcript when you need more — use `get_agent_activity` / the timeline if you need context around it. Cite the source as `<agentId>` / the title; never invent a quote that isn't in the snippet.

## Do not

- Do not paste full transcripts or files back into chat; the user asked for a search, not a replay.
- Do not guess at what a snippet means; report what it says and where it came from.
