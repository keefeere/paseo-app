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
activity first, 12 per page, under a 6-second budget, and returns `nextCursor` plus `partial`.
Gated on `server_info.features.messageSearch`: an older host contributes nothing rather than a
partial answer assembled from other RPCs.

Each hit carries `epoch` and `seq` plus the ranges the matcher marked. A row opens the chat and
leaves a jump request in `stores/chat-message-jump-store.ts`; the chat outline consumes it once
and scrolls to the position. Native has neither chat find nor the jump — it opens the chat.

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
