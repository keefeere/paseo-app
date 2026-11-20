# Search

Four surfaces, four engines. The keystroke decides what can be found, so "search finds
nothing" is usually the wrong surface, not a broken one.

| Surface                   | Opens                      | Engine                                                | Finds                                                              |
| ------------------------- | -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Command Center (All)      | `Ctrl`/`⌘K`                | `scoreTextFields` client-side, daemon file search     | Workspaces (title, subtitle, agent titles), files by path, actions |
| Command Center (Messages) | `Ctrl`/`⌘K`, then Messages | `agent.messages.search.request` + `search/lang-match` | Message text of every chat on the host, including archived ones    |
| Chat find                 | `Ctrl`/`⌘F` inside a chat  | `agent.timeline.search.request`                       | One chat's user and assistant text, as a phrase                    |
| Sessions                  | History panel              | `scoreTextFields` with `typoTolerant`                 | Agent and workspace titles, branches                               |

## Scoring

Command Center rows are filtered by `scoreTextFields`
(`packages/protocol/src/search/text-match.ts`): whitespace-separated tokens, every token must
land in some field, token order free. A row with one unmatched token is dropped, which is why a
two-word query over action titles usually answers "No matches".

File rows come from `searchDirectoryEntries`
(`packages/server/src/utils/directory-suggestions.ts`): path matching only, `.gitignore`
respected, 20 000 entries scanned at depth 12. Deeper than the budget means silently absent.

## Message search

Message text lives only in the provider transcript, so a search loads each agent with
`purpose: "history"` — the same read path opening an archived chat uses. The handler
(`packages/server/src/server/session.ts`, `handleAgentMessagesSearchRequest`) walks agents newest
activity first, 12 per page, and returns `nextCursor` plus `partial`. Loads run 4 at a time under
their own 8-second budget and the scan gets a fresh 6 seconds after them: one budget over both
means three slow hydrations eat it and the host answers "no matches" while holding the text. The
load budget is enforced inside a chunk (`withTimeout`), not only between chunks — one 13-second
hydration otherwise pushed a whole request to 20+ seconds. A hydration that runs out of budget is
not a failure: the agent goes to the warm queue and keeps loading in the background.
Gated on `server_info.features.messageSearch`: an older host contributes nothing rather than a
partial answer assembled from other RPCs.

Each agent is searched through a word index (`packages/server/src/server/agent/message-search/index.ts`)
built once per `(agentId, epoch)` and held for the 24 most recently searched agents. Postings are
token and stem → messages; a query intersects postings, and only the survivors are scored by
`scoreLangTokens`, which stays the single source of truth for tiers and highlight ranges. While an
agent's loaded head (`epoch`, `seq`) still matches its index, the handler skips reading its rows
entirely — `getLoadedTimelineHead` is cheap, `fetchTimeline` and `getCommittedTimelineRows` are
not. The fuzzy pass over the vocabulary runs only when a token matched nothing at all, and scoring
is capped at 1500 candidates newest first, which is what `partial` reports. Rows are read
unprojected (`getCommittedTimelineRows`): a 20k-row transcript scores in about a second, so a
projection on top of it is pure waste, and neither tool collapse nor reasoning merge changes what
a text scan finds.

The index is memory-only. Warming it inside a request is what made the first search after a deploy
feel broken, so an agent whose index is too expensive to build inside the remaining budget is
queued instead (one agent per tick, one warm loop at a time) and the response reports `partial`.
Warming also runs ahead of any search: the first `fetch_agents_request` of a session schedules the
10 most recently active chats 15 seconds later, so a host that has been up for a while answers
from postings. Warming to disk is the open work. A timeline replacement changes the epoch, which
drops the entry.

Each hit carries `epoch` and `seq` plus the ranges the matcher marked. The client
(`packages/app/src/command-center/message-search.ts`) walks up to 3 pages per host and publishes
what each page returned instead of waiting for the last one — a host that needs tens of seconds to
scan every chat shows its first hits while it keeps scanning. A row opens the chat and leaves a
jump request in `stores/chat-message-jump-store.ts`; the chat outline consumes it once and scrolls
to the position. Native has neither chat find nor the jump — it opens the chat.

Markdown is searched block by block, the same rule as chat find
(`packages/server/src/server/agent/chat-search/index.ts`): a hit the client cannot highlight
inflates the result list.

## Language-tolerant matching

`packages/protocol/src/search/lang-match.ts` adds stem tiers and Unicode typos on top of
`text-match`, because nobody recalls the inflection they read weeks ago: `який` finds `яка`,
`максимально` finds `максимальна`, `рендері` finds `рендер`, and word order stays free. Stems are
a suffix table, not a morphological analyzer — a wrong suffix costs a rank, never a match, since
the exact tiers run first.

`text-match` splits words on `[a-z0-9]`, so its fuzzy tier never sees a Cyrillic word; the typo
tier over `\p{L}\p{N}` belongs to `lang-match`. Keep pickers and Command Center rows on
`text-match` — they search labels the user can read, and stem tolerance there would only add
noise. Message search is the one place `lang-match` runs.
