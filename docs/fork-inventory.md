# Fork inventory

Reconciled against fork `main` (`72d5f4ffb`) and official upstream tag `v0.17.4` (an ancestor of `main`), checked 2026-11-25 UTC.

`git diff --name-only v0.17.4 72d5f4ffb` spans **272 files**. Every changed file maps to one of the 11 feature groups below, the shared app settings schema (`use-settings`), or 3 accidental merge-resolution artifacts.

Sources reconciled: full tree diff (`v0.17.4..72d5f4ffb`), the 88 first-parent non-merge commits since `v0.15.0` ([fork-commit-queue.md](fork-commit-queue.md)), all non-ancestor remote and local feature/fix branches, upstream PRs checked 2026-11-24/25, the v0.15 personal vault inventory (`home/AI/Paseo-доробки.md`), release evidence (`knowledge/home/paseo/fork-v0150-release-evidence.md`), and curated Paseo agent histories. Vault paths are logical references, not repository links.

**Evidence boundary:** **Reconciled** means source diff, Git history, branches, PRs, vault records, and targeted automated tests have been reconciled against `v0.17.4` and `72d5f4ffb`. Passing unit or mock-provider tests do not establish live multi-platform UI acceptance, real-provider replay, or published release verification; run the manual checks below after an upstream merge.

**Changes since the snapshot:** `13dcca16b` corrected the CI workflow test, and `94e8e1315` synchronized the Ukrainian resource (the implementing agent reported locale tests passing). Subsequent fixes address the two flatten model discrepancies, daemon image projection, Pi history event assertions, and no-echo steer image identity. The findings and test counts below describe the original snapshot, not the current working tree. Rewind-time image cleanup is not implemented: no deletion of refs or files anywhere. Rewindable providers can preserve the rewound-away branch (Claude forks, Codex forks, Pi navigates the tree, OMP branches, plugin-defined `session.revert`), so absence from the active-branch replay proves nothing about inactive branches; and no exclusive lock over the home exists — the PID lock is a boot-time identity check, not a write exclusion — so even zero-referenced-file sweeps cannot be proven safe against another writer. Pi image-only provider replay and live acceptance also remain open.

## Summary by feature group

| #   | Feature group                                                                                                   | Audit status | Code / test status    | Files | Upstream PR  | Primary open gaps                                                            |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------ | --------------------- | ----: | ------------ | ---------------------------------------------------------------------------- |
| 1   | [Cross-chat search and MCP](#1-cross-chat-search-and-mcp)                                                       | Reconciled   | Open gaps             |    31 | —            | Client stops at 3 pages / 40 hits without setting `partial`; no MCP/UI tests |
| 2   | [Ukrainian localization](#2-ukrainian-localization)                                                             | Reconciled   | Failing tests         |    27 | #5933 open   | 82 English-only + 8 UK-only keys; `host-filter.tsx` stale label risk         |
| 3   | [Appearance spacing and sidebar density](#3-appearance-spacing-and-sidebar-density)                             | Reconciled   | Passing targeted      |    49 | —            | Settings sidebar scroll scaling untested; live draft preservation unverified |
| 4   | [Single-workspace project flattening](#4-single-workspace-project-flattening)                                   | Reconciled   | Open gaps             |     3 | —            | Pinned workspaces excluded before flatten count; collapsed shortcut gap      |
| 5   | [User images and rewind](#5-user-images-and-rewind)                                                             | Reconciled   | Open gaps             |    29 | #5829 open   | Plugin `mediaType` vs `mimeType` bug; rewind/steer/provider gaps vs #5829    |
| 6   | [Pi full active-path history](#6-pi-full-active-path-history)                                                   | Reconciled   | Failing tests         |    10 | —            | Two `agent.test.ts` cases fail on trailing `session_metrics_updated`         |
| 7   | [Plugin code-block actions](#7-plugin-code-block-actions)                                                       | Reconciled   | Passing targeted      |    32 | #5874 open   | Browser E2E cap test and native acceptance not run in this audit             |
| 8   | [Links, file-preview preflight, and terminal placement](#8-links-file-preview-preflight-and-terminal-placement) | Reconciled   | Passing targeted      |    39 | #5865, #5874 | App does not consume `FilePreviewUnavailableError` directly; no FIFO test    |
| 9   | [Local speech models and highlighting](#9-local-speech-models-and-highlighting)                                 | Reconciled   | Passing targeted      |     6 | —            | No live model download, audio synthesis, or visual rendering check           |
| 10  | [Desktop behavior and provider sheets](#10-desktop-behavior-and-provider-sheets)                                | Reconciled   | Passing targeted      |    20 | —            | No packaged Electron acceptance across platforms                             |
| 11  | [Fork build, Docker, and CI](#11-fork-build-docker-and-ci)                                                      | Reconciled   | Failing contract test |    20 | —            | `ci-workflow.test.mjs:618` literal `mkdir` check; AppImage `TMPDIR` unported |

Shared files outside a single group: `packages/app/src/hooks/use-settings/{index.ts,storage.ts,storage.test.ts}` (3 files shared by groups 3, 4, and 8) and 3 merge-resolution artifacts below. Total: `266 + 3 + 3 = 272`.

## Open findings and merge artifacts

### Failing tests on `main` (`72d5f4ffb`)

1. **Ukrainian locale parity** (`packages/app/src/i18n/resources.test.ts:180`): fails for `uk` with 2,493 canonical keys vs 2,567 in English — 82 English-only keys (`settings` 39, `newWorkspace` 26, `providerUsage` 8, `message` 7, `shell` 1, `workspace` 1) and 8 Ukrainian-only keys (net -74).
2. **CI workflow contract** (`scripts/ci-workflow.test.mjs:618`): 31/32 pass; fails because the assertion checks for literal `mkdir -p release-manifests` before `cd release-manifests`, whereas fork `desktop-release.yml` runs `mkdir -p release-manifests/final`.
3. **Pi history event assertions** (`packages/server/src/server/agent/providers/pi/agent.test.ts`): `streamHistory preserves full branch history across compactions and emits compaction item` (expects 5, gets 6) and `streamHistory falls back to getMessages when getEntries fails` (expects 2, gets 3) fail because `streamHistory` now emits a trailing `session_metrics_updated` event without `item`.

### Confirmed code and model discrepancies

4. **Plugin user-image projection filter** (`packages/app/src/plugins/timeline/projection.ts`): checks `"mediaType" in image`, while `AgentTimelineImage` and its wire schema use `mimeType` and `source`. Schema-shaped daemon images are filtered out to `[]`. Reproduced with an isolated Vitest case (present since `25ee48254`).
5. **Flattened sidebar pinned-workspace counting** (`packages/app/src/utils/sidebar-project-row-model.ts` + `sidebar-workspace-list.tsx`): `splitPinnedSidebarGroups` removes pinned workspaces before `buildSidebarProjectRowModel` checks `workspaces.length === 1`, so a 2-workspace project with 1 pinned flattens, contrary to the original pre-pin requirement (`28668961e`). Reproduced in an isolated Vitest case.
6. **Flattened sidebar keyboard shortcuts** (`packages/app/src/components/sidebar/sidebar-projection.ts`): `buildSidebarShortcutSections` skips collapsed projects while `buildSidebarProjectRowModel` ignores collapsed state when flattening a single workspace, leaving a visible flattened row unreachable via sidebar shortcuts. Reproduced in an isolated Vitest case.
7. **Search client local pagination cap** (`packages/app/src/command-center/message-search.ts`): `searchHost` stops after 3 pages or 40 hits even when `nextCursor` is non-null, setting `partial` only from `payload.partial`. A response with `partial: false`, 40 hits, and a remaining cursor truncates silently without showing `command-center-partial-hint`.
8. **Host-filter language refresh** (`packages/app/src/components/hosts/host-filter.tsx`): memoizes `getHostPickerLabel` (localized via `i18n.t` in `host-picker-constants.ts`) on `[hosts, includeAllHost, selectedHost]` with no `useTranslation` subscription; stale-label risk after switching UI language (compare unmerged `origin/fix/host-filter-lint` `0eb5d6bf0`).

### Unported later image-branch behavior (PR #5829 `103b698ac`)

9. **Rewind image cleanup** (`packages/server/src/server/agent/agent-manager.ts`): no ref or file deletion on rewind. The active-branch replay alone cannot justify deleting refs: rewindable providers can preserve the rewound-away branch (Claude forks via `forkSession`, Codex forks via `revertCodexConversation`, Pi navigates the tree via `navigateTree` — Pi even captures whole-tree user entries as rewind targets — OMP branches via `runtimeSession.branch`, plugin-defined `session.revert` is unknown by contract), so a message absent from the active-branch replay is not provably dead. File deletion is equally unproven: the home is not under an exclusive lock — `acquirePidLock` is a boot-time identity check (`paseo.pid`, created with `wx`, no file descriptor held, not respected by third-party tools), and record writes are per-file atomic (`writeJsonFileAtomic`) with no cross-file or cross-process exclusion — so no sweep run by this process can prove a file unreferenced by a writer it cannot see. A strict fail-closed disk scan was built for the sweep and then removed: it still skipped symlinked directories/files (`Dirent.isFile/isDirectory` is false for symlinks) and could not stop a concurrent writer, so it could not prove the reference set either. Rewinds therefore keep refs and files; the image store retains every persisted image byte, and the daemon has no destructive GC at rewind. Tests: orphan and shared-ref survival, anonymous/mixed replays, invalid record files in unrelated project directories, and a two-process writer (third-party child writes a record + image into the home; nothing is deleted). Live rewind is unverified on all providers.

   **`deleteAgentState` GC is unchanged (pre-existing, separate decision).** `deleteAgentState` still runs the base behavior: collect referenced image ids from the in-memory cache (`registry.listAll()` → `collectReferencedConversationImageIds`) and `garbageCollect(referencedIds)`, which deletes files absent from that set. This is intentionally **not** modified here and intentionally unproven:
   - The cache can under-report refs after silent load failures (`doLoad`/`scanDisk`/`readRecordFile` swallow errors, per `agent-storage.ts`) and after a reboot, because it is not re-derived strictly from disk.
   - Symlinked record files and project directories are invisible (`Dirent.isFile/isDirectory` is false for symlinks).
   - No cross-process exclusion: a third-party writer can hold refs this sweep cannot see.
   - Malformed/unparseable records are skipped, hiding their refs.
     Net: this GC is a retention risk, not a guarantee. Its fix (an exclusive lock + symlink/schema-aware scan + provider unreachable-branch proof) is a separate decision; until it lands, its behavior is the pre-existing behavior by design.

10. **No-echo steer image recovery** (`packages/server/src/server/agent/agent-manager.ts`): mock-provider test adapted from PR #5829 fails with `Steered prompt image was not recovered` after restart (`recordSubmittedPrompt` does not link accepted steer IDs without an echo).
11. **Pi provider-only image replay** (`packages/server/src/server/agent/providers/pi/history-mapper.ts`): `mapUserMessage` returns no event when a Pi user message contains only images and no text. Confirmed by isolated mapper test; separate daemon submitted-image storage still covers daemon-recorded prompts.
12. **Other PR #5829 deltas**: `ConversationImageStore.importImage`, `providers/user-message-images.ts`, `anonymousUserImageKey`, and Codex `imageView` → `view_image` tool-call mapping (`fd72b1fdb`; `main` renders `imageView` as assistant Markdown) are absent from `main`.

### Unported historical branch follow-ups to review deliberately

13. **AppImage smoke `TMPDIR` isolation** (`origin/fix/appimage-smoke-startup` `161e1eb95`): per-launch `TMPDIR` in `packages/desktop/e2e/packaged-app-smoke.js` is absent from `main`. That branch's `f08330fa8` selector (`file-preview-unavailable`) targeted the old `file-pane/unavailable-resource.tsx`, now replaced by `file-pane/pane.tsx`.
14. **Hardcoded UI string localization** (`local:feat/local-tts-piper-uk` `303cdaa4f`): 40-file localization pass over `components/schedules/`, `add-project-flow.tsx`, and shell surfaces was not carried across the v0.15 clean-base port.

### Accidental merge-resolution artifacts in `main` (not fork features)

15. **`packages/server/src/utils/worktree.ts:1412`**: duplicate 6-line `update-ref refs/paseo/kept-commits/${commit}` block left inside `deletePaseoWorktreeAtRepositoryRoot` during `ea1b0c504` (`Merge tag 'v0.17.4'`); upstream already performs the same ref update at line 1522.
16. **`packages/app/.vitest-attachments/e1067cd51779244780e49d290482dd5a8e1439bb.png`**: stray Vitest PNG committed during `4850b6ad2` (`Merge tag 'v0.16.0'`).
17. **`packages/server/src/terminal/worker-terminal-manager.ts:1285`**: two comment lines accidentally dropped during `22590d69d` (`Merge upstream v0.17.3`).

---

## Feature groups

### 1. Cross-chat search and MCP

**What it does & key files:** Adds full-text search across all chat messages in Command Center (**Messages** tab) and via the `search_messages` MCP tool, with language-tolerant (stem + typo) and `exact` substring modes, background index warming, whole-word strict matching for short (`<3` chars) and numeric tokens, and scan-budget `partial` reporting. Detailed spec lives in [search.md](search.md).

- **Protocol & client:** `packages/protocol/src/search/{lang-match.ts,text-match.ts}`, `packages/protocol/src/paseo-tool-presentation/catalog.ts`, `packages/client/src/daemon-client.ts` (`searchAgentMessages`).
- **Server & skills:** `packages/server/src/server/agent/message-search/index.ts`, `packages/server/src/server/agent/chat-search/index.ts`, `packages/server/src/server/agent/tools/paseo-tools.ts`, `packages/server/src/server/authorization/operation-permissions.ts` (`workspace.read`), `packages/server/src/server/websocket-server.ts` (`messageSearch` capability), `packages/server/src/server/session.ts` (cache invalidation on timeline replacement and agent removal), `skills/paseo-search/SKILL.md`, `skills/paseo/SKILL.md`.
- **App:** `packages/app/src/command-center/{command-center.tsx,message-search.ts,results.ts,sections.ts,tabs.ts}`, `packages/app/src/stores/chat-message-jump-store.ts`, `packages/app/src/agent-stream/chat-outline/use-chat-outline.ts`.

**Origin & reconciliation:** First-parent commits `9018b1d75`, `216702e55`, `8317bba87`, `3288b76e5`, `8d54d3b9e`, `cffc03e8b`, `3f198dac5`, `2d85af039`, `679493d90`, and `72d5f4ffb` (strict short/numeric tokens, cache invalidation, `command-center-partial-hint`). Absent from `v0.17.4`.

**Merge boundaries:** Carry the `messageSearch` capability gate, `workspace.read` permission mapping, `chat-message-jump-store.ts` (token-checked handoff of host ID, agent ID, timeline epoch, and sequence), and `use-chat-outline.ts` epoch fetch together; dropping the jump store breaks navigation to unloaded assistant replies.

**Verification & gaps:**

- Passed on `72d5f4ffb`: `packages/protocol/src/search/lang-match.test.ts` (14 tests, including strict short/digit tokens), `packages/server/src/server/agent/message-search/index.test.ts` (18 tests, after `npm run build:client`), and `packages/server/src/server/daemon-e2e/message-search.e2e.test.ts` (mock provider).
- Passed on `679493d90`: `packages/app/src/command-center/tabs.test.ts` and `packages/app/src/agent-stream/chat-outline/use-chat-outline.test.tsx` (8 tests).
- **Gaps:** No server test exercises the `search_messages` MCP tool directly. `use-chat-outline.test.tsx` and `command-center/sections.test.ts` do not cover `requestJump`/`jumpToMessage`. Client `searchHost` stops at 3 pages / 40 hits with non-null `nextCursor` without raising `partial`. Multi-host UI jump and live partial-hint rendering remain unverified interactively.

---

### 2. Ukrainian localization

**What it does & key files:** Registers Ukrainian (`uk` / Українська) in Settings → General → Language, translates fork and upstream UI strings, localizes relative time and durations, and refreshes static date labels on language switch.

- **Core i18n:** `packages/app/src/i18n/{i18next.ts,locales.ts,resources/uk.ts}`, fork keys mirrored across all 9 other locale files (`ar`, `en`, `es`, `fr`, `ja`, `ko`, `pt-BR`, `ru`, `zh-CN`), `docs/i18n.md`.
- **Localized surfaces:** `packages/app/src/utils/time.ts`, `packages/app/src/hooks/use-time-ago.ts`, `packages/app/src/components/hosts/{host-picker.tsx,host-picker-constants.ts}`, `packages/app/src/screens/settings/{browser-tools-card.tsx,browser-tools-config.ts,host-page.tsx,host-appearance-section.tsx}`, `packages/app/src/panels/setup-panel.tsx`, `packages/app/src/components/sidebar/sidebar-workspace-menu.tsx`.

**Origin & reconciliation:** First-parent commits `2e796c046`, `707a0c650`, `0a13be0ba`, `69b0160ce`, `8670a64a9`, `4e42454f7`, `8e4a8b5b1`, `a8c26066b`, `e9782dd1b`, `b1eed5590`, `e1befadd1`, `f8db90eba`, `2ee7de7c3`, `360e76d0d`. Upstream PR [#5933](https://github.com/getpaseo/paseo/pull/5933) is open. Non-ancestor `origin/feat/i18n-ukrainian` commits (`349711923`, `235d7e9a9`, `ca65aefae`, etc.) are represented on `main` except `host-filter.tsx` (tracked under `origin/fix/host-filter-lint` `0eb5d6bf0`). Upstream `v0.17.4` already adopted `useTranslation` in `usage/window-bar.tsx`, whereas `local:feat/local-tts-piper-uk` `303cdaa4f` (hardcoded strings in `components/schedules/`, `add-project-flow.tsx`, and shell surfaces) was not carried across the v0.15 port.

**Merge boundaries:** Always carry fork-specific keys across all 10 locale files, not only `uk.ts`. `i18next.ts` sets `fallbackLng: "en"`, so missing `uk` keys silently render English.

**Verification & gaps:**

- **Failing on `72d5f4ffb`:** `cd packages/app && npx vitest run src/i18n/resources.test.ts --bail=1` fails at line 180 (`uk`: 2,493 vs 2,567 English canonical keys — 82 English-only, 8 UK-only). Literal source search found no non-test consumers for the 8 UK-only keys; check dynamic lookups before deleting them, and translate the 82 missing keys properly rather than copying English placeholders.
- Passed on `679493d90`: `packages/app/src/i18n/locales.test.ts` (15 tests) and `packages/app/src/utils/time.test.ts` (38 tests).
- **Gaps:** `locales.test.ts` checks `uk` in options but omits `uk` from its parse-all-supported-languages check. `host-filter.tsx` lacks a `useTranslation` subscription for localized `getHostPickerLabel`.

---

### 3. Appearance spacing and sidebar density

**What it does & key files:** Adds four independent appearance sliders — **Interface spacing** (`50–125%`), **Paragraph and block spacing** (`0–150%`), **Line height** (`110–180%`), and **Sidebar row spacing** (`0–150%`) — computing `sidebarSpacing`, `sidebarRow` (down to 18 px control floor at 0%), `uiRow`, `textSpacing`, and `textLineHeight` tokens without mutating horizontal padding or shrinking large fonts.

- **Engine & tokens:** `packages/app/src/appearance/{spacing.ts,apply.ts,provider.tsx}`, `packages/app/src/styles/theme.ts`, `packages/app/src/components/appearance-style-boundary.tsx`, `packages/app/src/components/ui/{slider.tsx,slider.web.tsx,slider-types.ts,control-geometry.ts,menu/menu-item.tsx}`, `packages/app/src/components/settings/row-density.tsx`, `docs/unistyles.md`.
- **Consumers:** `packages/app/src/screens/settings/appearance/{appearance-section.tsx,appearance-preview.tsx}`, `packages/app/src/navigation/settings-presentation/{index.ts,model.ts}` (proportional sidebar scroll preservation across web appearance remounts), `packages/app/src/components/markdown/{block-stack.tsx,styles.ts}`, `packages/app/src/agent-stream/view.tsx`, `packages/app/src/review/surface.tsx`, `packages/app/src/composer/{index.tsx,input/input.tsx}`, `packages/app/src/components/sidebar/{project-leading-visual.tsx,sidebar-group-toggle-row.tsx,sidebar-header-row.tsx,sidebar-status-list.tsx,sidebar-workspace-row-content.tsx}`, `packages/app/src/screens/workspace/scripts/workspace-scripts-button.tsx`, and theme-fixture updates in 12+ app unit/E2E tests.

**Origin & reconciliation:** First-parent commits `03753bd28`, `2cc65f6da`, `e4c072987`, `7e153a12e`, `2c91bde89`, `48bd678a1`, `6cd321674`, `6ca471963`, `cb7b95368`, `9da809d04`, `e4606bfcc`, `672ce4ce9`, `599a42350`, `c78bacf56`. Non-ancestor `fix/spacing-port`, `c48e60467` (`sidebarRow`), and `dee316980` are superseded by the carried implementation on `main` (including independent `sidebarSpacing` from `672ce4ce9` and `uiRow` from `599a42350`). Historical note from agent `fd602130`: there is no fifth chat-row density slider.

**Merge boundaries:** Do not reintroduce a whole-workspace appearance remount (reverted in `e4606bfcc` because it wiped screen-owned editors, drafts, terminals, and plugin hosts). Keep `sidebarSpacing` independent of `interfaceSpacing`, preserve upstream `contentWidth` alongside fork settings in `hooks/use-settings/storage.ts`, and follow [unistyles.md](unistyles.md).

**Verification & gaps:**

- Passed on `679493d90`: `packages/app/src/appearance/apply.test.ts`, `packages/app/src/components/appearance-style-boundary.test.ts` (3 tests), `packages/app/src/navigation/settings-presentation/model.test.ts` (10 tests), and filtered `packages/app/src/hooks/use-settings/storage.test.ts` (independent spacing bounds).
- **Gaps:** `navigation/settings-presentation/model.test.ts` does not test `rememberHeight` or proportional scroll scaling. Draft/attachment preservation and visual review/chat/sidebar spacing across platforms require manual verification.

---

### 4. Single-workspace project flattening

**What it does & key files:** Optional sidebar setting (`flattenSingleWorkspaceProjects`) that renders a project containing a single workspace as a combined `project_workspace` row instead of a collapsible project header plus nested child row.

- **Files:** `packages/app/src/utils/sidebar-project-row-model.ts`, `packages/app/src/components/sidebar-workspace-list.tsx`, `packages/app/src/screens/settings/sidebar/sidebar-nav-section.tsx`, plus `hooks/use-settings/storage.ts`.

**Origin & reconciliation:** First-parent commits `82c402b15`, `2cc65f6da`, `2c91bde89`. Non-ancestor `origin/feat/flatten-single-workspace-projects` (`28668961e`) contained explicit unit tests for flattening (collapsed state, add-workspace action, 1↔2 workspaces, empty projects) that were not carried into the current test file.

**Verification & gaps:**

- `packages/app/src/utils/sidebar-project-row-model.test.ts` passed (15 tests), **but never enables `flattenSingleWorkspaceProjects` or asserts `project_workspace`**.
- **Two confirmed model discrepancies (reproduced in isolated Vitest runs):**
  1. `splitPinnedSidebarGroups` strips pinned workspaces before `buildSidebarProjectRowModel` runs, so a 2-workspace project with 1 pinned flattens (contrary to the original pre-pin counting requirement in `journal/2026/10/13/2026-10-13-091100-компактні-проєкти-paseo-28668961.md`).
  2. `buildSidebarShortcutSections` skips collapsed projects while `buildSidebarProjectRowModel` flattens them regardless of collapsed state, so a visible flattened workspace can be omitted from keyboard shortcuts.

---

### 5. User images and rewind

**What it does & key files:** Persists user-submitted images on the daemon across reconnects/restarts (`AgentTimelineItem` optional `images` on `user_message`), retains local `preview_*` attachments while mounted so local GC does not evict visible pills, serializes durable image refs in replica cache, and materializes remote images before conversation rewind to restore them into an empty composer.

- **Protocol & server:** `packages/protocol/src/{agent-types.ts,messages.ts}`, `packages/server/src/server/agent/{conversation-image-store.ts,agent-manager.ts,agent-storage.ts,agent-prompt.ts,agent-sdk-types.ts}`, `packages/server/src/server/bootstrap.ts`, `docs/{architecture.md,data-model.md,timeline-sync.md}`.
- **App:** `packages/app/src/types/stream.ts`, `packages/app/src/runtime/replica-cache/index.ts`, `packages/app/src/attachments/use-retained-attachment.ts`, `packages/app/src/utils/assistant-image-source.ts`, `packages/app/src/components/rewind/{rewind-image-attachments.ts,use-rewind-agent-mutation.ts,composer-restore.tsx}`, `packages/app/src/composer/draft/input-draft.ts`, `packages/app/src/plugins/timeline/projection.ts`.

**Origin & reconciliation:** First-parent commits `125610c74`, `25ee48254`, `509297d77`, `2f5a8a665`, `c062c1bcb` (`origin/fix/rewind-image-restore` is an ancestor). Upstream PR [#5829](https://github.com/getpaseo/paseo/pull/5829) (`origin/fix/5464-durable-user-image-history` = local `pr5829-sync`, head `103b698ac`) is open and is **not** an ancestor of `main` (historical pre-v0.15 merge `4975f946f` was left behind by the v0.15 clean-base port). Upstream `v0.17.4` `AgentTimelineItem` user messages have no `images` field.

**Merge boundaries:** Materialize remote images **before** `client.rewindAgent`, restore only into an empty composer (text before attachments), and skip message images on files-only rewind. Keep `preview_*` mounted retention (`use-retained-attachment.ts`), replica-cache lossless-coverage rules (still exclude non-image attachments), and `assistant-image-source.ts` resolution intact. Note: if a separate personal `user-images` plugin is installed alongside native image pills, duplicate image cards can appear (`journal/2026/11/08/2026-11-08-225900-paseo-chat-image-doubled-plugin-root-cause-b7e4d902.md`).

**Verification & gaps:**

- Passed on `679493d90`: `packages/protocol/src/messages.attachments.test.ts` (13), `packages/server/src/server/agent/conversation-image-store.test.ts`, filtered `agent-manager.test.ts` (`canonical user messages retain durable submitted image references`), `packages/app/src/types/stream.test.ts` (70), `packages/app/src/runtime/replica-cache/index.test.ts` (61), `packages/app/src/attachments/{use-retained-attachment.test.tsx,gc-retention.test.ts}`, `packages/app/src/utils/assistant-image-source.test.ts` (8), and `packages/app/src/components/rewind/{rewind-image-attachments.test.ts,use-rewind-agent-mutation.test.tsx,composer-restore.provider.test.tsx}`.
- **Confirmed bugs / unported PR #5829 gaps:**
  - `plugins/timeline/projection.ts` checks `"mediaType" in image` instead of `mimeType` (reproduced: plugin transforms receive `[]`).
  - Ref pruning on rewind is not implemented: rewindable providers can preserve the rewound-away branch, so removed image references survive (Pi captures whole-tree user entries as rewind targets). No file deletion on rewind: the home is not under an exclusive lock and symlinks/concurrent writers are invisible to any scan.
  - Mock-provider no-echo steer fails to recover image after restart (`recordSubmittedPrompt` does not link accepted steer ID).
  - `persistSubmittedPromptImages` returns early without `clientMessageId`; `ConversationImageStore.importImage`, `providers/user-message-images.ts`, and `anonymousUserImageKey` are absent.
  - Codex `imageView` renders as assistant Markdown (tested), unlike PR #5829 `fd72b1fdb` (`view_image` tool call).
  - Pi mapper drops image-only user messages (see group 6).

---

### 6. Pi full active-path history

**What it does & key files:** Replays the full active branch of a Pi session across compactions via `buildPiSessionPath` (following parent IDs from leaf and applying context edits), emits compaction markers without summary text, and collects whole-tree user IDs separately for rewind target indexing.

- **Files:** `packages/server/src/server/agent/providers/pi/{transcript.ts,history-mapper.ts,cli-runtime.ts,rpc-types.ts,agent.ts,test-utils/fake-pi.ts}`, `docs/providers.md`, plus `history-mapper.test.ts`, `cli-runtime.test.ts`, `agent.test.ts`.

**Origin & reconciliation:** First-parent commits `efb87f30d`, `0d65fbea6`. Upstream `v0.17.4` lacks `buildPiSessionPath` in `history-mapper.ts`. Preserve all five Pi files and replay wiring together across merges.

**Verification & gaps:**

- Passed on `679493d90`: `packages/server/src/server/agent/providers/pi/history-mapper.test.ts` (synthetic compaction, rewound-branch isolation, and pre-compaction fork cases) and pre-compaction rewind case in `agent.test.ts`.
- **Failing on `main`:** Two cases in `packages/server/src/server/agent/providers/pi/agent.test.ts` (`streamHistory preserves full branch history across compactions and emits compaction item` and `streamHistory falls back to getMessages when getEntries fails`) fail because `streamHistory` now appends a `session_metrics_updated` event without `item`. Filtering to `timeline` events in a temporary copy passed both cases; update the assertions in the owning code branch.
- **Gaps:** `PiHistoryMapper.mapUserMessage` drops image-only user messages when text is empty (confirmed via isolated mapper test; differs from PR #5829 `ae0fb57a7`). Live Pi compaction replay on 0.17, inactive-branch viewing, and real-provider rewind remain unverified.

---

### 7. Plugin code-block actions

**What it does & key files:** Exposes `client.addCodeBlockActions` in the plugin SDK so plugins can render inline actions beneath assistant Markdown code blocks on both web and native, distinguishing complete fences from streaming or render-cap-truncated tails.

- **SDK & docs:** `packages/plugin/src/client/{contracts.ts,index.ts}`, `docs/plugins.md`, `public-docs/plugins/{migration.md,reference.md,reference.zh-CN.md}`.
- **App:** `packages/app/src/plugins/{code-block-actions.tsx,evaluate.ts,registry.ts,types.ts}`, `packages/app/src/components/markdown/{renderers.web.tsx,renderer.tsx,fence/mermaid/segments.ts}`, `packages/app/src/components/message.tsx`, `packages/app/e2e/browser/plugin-timeline.spec.ts`, and plugin test fixtures.

**Origin & reconciliation:** First-parent commits `df73c844d`, `5e9e30872`, `cc8e71596`, `200a61e96`. Upstream PR [#5874](https://github.com/getpaseo/paseo/pull/5874) (`origin/feat/terminal-open-location` `34698dcb0`) is open. Review follow-up `4c3671905` (memoized action components via `isComponentType` in `evaluate.ts` and capped-fence streaming detection in `code-block-actions.tsx`) is represented in `main`. Absent from `v0.17.4`.

**Verification & gaps:**

- Passed on `679493d90`: `packages/app/src/plugins/evaluate.test.ts` (including 5 code-block registration cases for memoized components and malformed contributions) and `packages/app/src/plugins/timeline/view.test.tsx`.
- **Gaps:** `packages/app/e2e/browser/plugin-timeline.spec.ts` (render-cap fence test) and native visual/execution acceptance were not run in this audit. Remember commands triggered via terminal-integration actions execute on the agent's daemon host, not the client device.

---

### 8. Links, file-preview preflight, and terminal placement

**What it does & key files:** Controls how chat HTTP URLs (`chatLinkBehavior`: `ask` / `internal-side` / `internal-tab` / `external`), custom application URI schemes (`systemLinkBehavior`, allowlisted in `external-url.ts` e.g. `obsidian://`, `logseq://`, `notion://`, `slack://`, `tg://`, `discord://`, rejecting `javascript:`, `file:`, and control characters), resource links with server-side preview preflight (`FilePreviewUnavailable`), and terminal open location (`openInSidePane.terminals` + plugin `openTerminal`) behave.

- **Protocol & client:** `packages/protocol/src/{external-url.ts,messages.ts}`, `packages/client/src/daemon-client.ts` (`FilePreviewUnavailableError`).
- **Server:** `packages/server/src/server/file-explorer/service.ts` (`getUnavailableFilePreview` for directories, non-regular files, oversized, unsupported binary), `packages/server/src/server/session/files/workspace-files-session.ts`.
- **App & desktop:** `packages/app/src/assistant-file-links/{open-chat-link.ts,parse.ts,provider.tsx,resolver.ts,system-link-dialog.tsx,use-file-link.ts}`, `packages/app/src/utils/{open-external-url.ts,explorer-paths.ts}`, `packages/app/src/file-pane/{pane.tsx,resource-actions.tsx}`, `packages/app/src/screens/settings/open-location/open-location-section.tsx`, `packages/app/src/plugins/{host-navigation.ts,host-navigation-model.ts}`, `packages/app/src/workspace-tabs/{open-beside.ts,agent-visibility.ts}`, `packages/app/src/stores/workspace-layout-actions.ts`, `packages/app/src/panels/{pane-context.tsx,agent-panel.tsx,provider-subagent-panel.tsx}`, `packages/app/src/screens/workspace/{workspace-pane-content.tsx,workspace-screen.tsx}`, `packages/app/src/components/{toast-android.ts,toast-android.native.ts,toast-host.tsx}`, `packages/desktop/src/features/opener.ts`, `docs/explorer-sidebar.md`.

**Origin & reconciliation:** First-parent commits `4ab5e8e3f`, `f142fb6cd`, `778e97a80`, `bd052cc21`, `d9a06d4aa`, `143f7d53a`, `6f319721f`, `f0e32c409`, `12f664bcf` (splits `ToastAndroid` and keeps desktop settings out of chat module graphs). Upstream PRs [#5865](https://github.com/getpaseo/paseo/pull/5865) and [#5874](https://github.com/getpaseo/paseo/pull/5874) are open; [#5760](https://github.com/getpaseo/paseo/pull/5760) is closed without merge. Historical `terminalOpenLocation` and `chatLinkOpenTarget` were renamed to `openInSidePane.terminals` and `chatLinkBehavior`. Non-ancestor `local:feat/resource-link-opening` directory-reveal commits (`5c040b859`, `d5dd090a9`) are superseded by upstream `v0.17.4` `useFileExplorerActions().revealDirectory`.

**Verification & gaps:**

- Passed on `679493d90`: `packages/app/src/assistant-file-links/{open-chat-link.test.ts,resolver.test.ts,parse.test.ts}`, `packages/desktop/src/features/opener.test.ts`, `packages/app/src/workspace-tabs/open-supporting-view.test.ts` (23 tests; must run from `packages/app` so `__DEV__` setup loads), `packages/app/src/plugins/{host-navigation.test.ts,host-navigation.test.tsx}`, filtered `workspace-layout-store.test.ts`, filtered `storage.test.ts` (defaults to `ask`), `packages/server/src/server/session/files/workspace-files-session.test.ts` (20 tests), and `packages/server/src/server/file-explorer/service.test.ts`.
- **Gaps:** No standalone protocol unit test for `parseExternalUrl`. No direct consumer of `FilePreviewUnavailableError` in `packages/app/src` (the file pane catches errors into string snapshots or falls back to a generic binary-preview view). No FIFO non-blocking test, mixed-version wire test, or live third-party URI handoff check.

---

### 9. Local speech models and highlighting

**What it does & key files:** Adds two character-based local Ukrainian Sherpa VITS TTS voices (`vits-coqui-uk-mai`, `vits-mms-ukr`, requiring only `model.onnx` and `tokens.txt` without `espeak-ng-data`) and `whisper-small` local STT; adds `shell` alias and `$`-prompt `console` stream parsing to the syntax highlighter.

- **Files:** `packages/server/src/server/speech/providers/local/sherpa/{model-catalog.ts,sherpa-tts.ts}`, `packages/server/src/server/speech/providers/local/models.test.ts`, `packages/highlight/src/parsers.ts`, `packages/highlight/src/__tests__/highlighter.test.ts`, `packages/app/src/utils/highlight-cache.test.ts`.

**Origin & reconciliation:** First-parent commits `84d2758cc`, `89d31590d`, `2e94fbc90`, `4aa64434b`. Non-ancestor `local:feat/local-tts-piper-uk` (`bd657da2b`) and `origin/feat/shell-highlighting` (`39f1bdd1b`) are fully represented on `main`; `fix/v0.15.0-voice-models` and `fix/vits-uk-datadir` have no unmerged speech/highlight commits. Upstream `v0.17.4` already highlights `sh`/`bash`/`zsh` and `dockerfile` (preserve Dockerfile during merges); the fork adds `shell` and `$`-only `console` (the old vault note's claim about `#` prompts is unsupported by the original branch).

**Verification & gaps:**

- Passed on `679493d90`: `packages/server/src/server/speech/providers/local/models.test.ts` and `packages/highlight/src/__tests__/highlighter.test.ts` (56 tests total).
- **Gaps:** No live model download, Ukrainian audio synthesis, Whisper transcription, or visual code-block rendering test was run.

---

### 10. Desktop behavior and provider sheets

**What it does & key files:** Routes Electron file downloads through the main process (`paseo:download:start`) instead of navigating the app window, adds an initial-response timeout (`unreachable`) without interrupting active transfers, keeps completed download toasts with **Open** / **Open folder** buttons when `savedPath` exists (3-second auto-dismiss otherwise), guards packaged Electron startup/updater against closed stdout/stderr pipes (`EPIPE`), targets `keefeere/paseo-app` in `electron-builder.yml`, and caps desktop provider diagnostic/detail sheets at 780 px.

- **Desktop:** `packages/desktop/electron-builder.yml`, `packages/desktop/src/{main.ts,preload.ts}`, `packages/desktop/src/features/{downloads.ts,closed-output.ts,dialogs.ts,auto-updater.ts,opener.ts}` and tests.
- **App:** `packages/app/src/desktop/host.ts`, `packages/app/src/stores/{download-store.ts,download-toast-policy.ts}`, `packages/app/src/components/download-toast.tsx`, `packages/app/src/provider-settings/internal/{diagnostic-sheet.tsx,provider-detail-sheet.tsx}`.

**Origin & reconciliation:** First-parent commits `33f4f8447`, `c1b4acd96`, `dcce23133`, `8f2845515`, `f43850cb3`, `00584b358`, `f31bca0a5`, `9f4924abb`, `73ebd2418`. Non-ancestor `fix/desktop-download`, `fix/download-active-connection`, `feat/download-toast-actions`, and `fix/updater-epipe` behaviors are all represented on `main`; `3e5e6d09b` (downloading over the host's active connection) is superseded by upstream `v0.17.4` `resolveDaemonDownloadTarget`. Preserve both the `closed-output` import order in `main.ts` and console logging (needed by packaged startup smoke).

**Verification & gaps:**

- Passed on `679493d90`: `packages/desktop/src/features/{downloads.test.ts,closed-output.test.ts,opener.test.ts}` and `packages/app/src/{stores/download-toast-policy.test.ts,components/download-toast.test.tsx}`.
- **Gaps:** No packaged Electron download, closed-pipe launch, updater feed, or wide-screen sheet visual check was run.

---

### 11. Fork build, Docker, and CI

**What it does & key files:** Adapts CI/release workflows for `keefeere/paseo-app`, gates macOS/Windows CI jobs and upstream-only deploy/Android/Nix/release-notes workflows to `getpaseo/paseo`, cuts artifact retention to 3 days, adds `CHECKOUT_REF` tagging to `desktop-release.yml`, exports checksummed Docker base archives with config-blob `image_id` plus optional `with_agents` agent-CLI child image (`/opt/agent-cli` writable by `paseo`), and makes Metro E2E warmup timeout configurable (`E2E_METRO_WARMUP_TIMEOUT_MS`). Full build policy lives in [fork-builds.md](fork-builds.md).

- **Files:** `.github/ci-paths.yml`, `.github/workflows/{android-apk-release.yml,ci.yml,deploy-app.yml,deploy-relay.yml,deploy-website.yml,desktop-packages.yml,desktop-release.yml,desktop-rollout.yml,docker.yml,nix-update-hash.yml,nix.yml,release-notes-sync.yml}`, `docker/{Dockerfile.agents.example,README.md}`, `docs/{docker.md,fork-builds.md}`, `packages/app/e2e/support/metro-warmup.mjs`, `scripts/ci-workflow.test.mjs`, `CLAUDE.md`.

**Origin & reconciliation:** First-parent commits `1448b43eb`, `0dd784787`, `00328aceb`, `c299a3e0f`, `e606c35ac`, `d518ae6d6`, `b06b7cf8d`, `45b603d46`.

- **Build-branch Windows delta:** `build/v0.17.4-beta.901` (`59c89b31a`) and `build/v0.17.4-beta.902` (`9279e0724`) carry a cherry-picked `desktop-release.yml` patch outside `main` that enables Windows builds and expects a Linux manifest plus Windows when its job succeeds (a Windows-only dispatch without an existing Linux manifest stops in draft).
- **Historical workflow branches:** `origin/fix/fork-release-publishing` (`af2be894f`) defaulted to `platform=linux` and `rollout_hours=0` with per-platform manifest assembly; current `main` defaults to `platform=all` and `rollout_hours=36` with Linux-only manifest assembly on `keefeere/paseo-app`. `origin/fix/appimage-smoke-startup` (`161e1eb95`) per-launch `TMPDIR` is not in `main`.

**Verification & gaps:**

- **Failing on `main`:** `node --test scripts/ci-workflow.test.mjs` passes 31/32 and fails at line 618 (expects `mkdir -p release-manifests`, fork runs `mkdir -p release-manifests/final`).
- **Gaps:** Green fork CI does not cover Windows or macOS runners. `with_agents` Docker export (`45b603d46`) was reviewed at source level only (no image built or deployed during the audit).

---

## Historical crosswalk and branch ledger

### Crosswalk from `home/AI/Paseo-доробки.md` (v0.15.0)

| Historical subject                  | Current owner                                                              |
| ----------------------------------- | -------------------------------------------------------------------------- |
| CI, releases, and updates           | [Group 11](#11-fork-build-docker-and-ci), [fork-builds.md](fork-builds.md) |
| Ukrainian localization              | [Group 2](#2-ukrainian-localization)                                       |
| Ukrainian TTS and Whisper Small     | [Group 9](#9-local-speech-models-and-highlighting)                         |
| Appearance spacing                  | [Group 3](#3-appearance-spacing-and-sidebar-density)                       |
| Flatten single-workspace projects   | [Group 4](#4-single-workspace-project-flattening)                          |
| Shell and console highlighting      | [Group 9](#9-local-speech-models-and-highlighting)                         |
| URI schemes and link routing        | [Group 8](#8-links-file-preview-preflight-and-terminal-placement)          |
| Terminal open location              | [Group 8](#8-links-file-preview-preflight-and-terminal-placement)          |
| Plugin code-block actions           | [Group 7](#7-plugin-code-block-actions)                                    |
| Desktop downloads and toast actions | [Group 10](#10-desktop-behavior-and-provider-sheets)                       |
| Closed output and updater           | [Group 10](#10-desktop-behavior-and-provider-sheets)                       |
| User-image history                  | [Group 5](#5-user-images-and-rewind)                                       |
| Provider sheet width                | [Group 10](#10-desktop-behavior-and-provider-sheets)                       |

Cross-chat search ([Group 1](#1-cross-chat-search-and-mcp)) and Pi full active-path replay ([Group 6](#6-pi-full-active-path-history)) post-date the v0.15 vault inventory.

### Non-ancestor branch dispositions

Only `origin/fix/rewind-image-restore` (`c062c1bcb`), `fix/spacing-port-main`, `fix/v0.15.0-features`, `fix/v0.15.0-voice-models`, and `fix/vits-uk-datadir` are ancestors of `main`. Dispositions for non-ancestor feature/fix branches:

| Branch                                                                                                                | Disposition vs `main` (`72d5f4ffb`)                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `origin/feat/chat-url-open-behavior` (local same)                                                                     | Carried in `main` (Group 8)                                                                                            |
| `origin/feat/flatten-single-workspace-projects`                                                                       | Core carried; flattening unit tests not ported; 2 model gaps remain (Group 4)                                          |
| `origin/feat/i18n-ukrainian`                                                                                          | Carried except `host-filter.tsx`; 82 newer upstream keys missing (Group 2)                                             |
| `origin/feat/shell-highlighting`                                                                                      | Carried in `main` (Group 9)                                                                                            |
| `origin/feat/terminal-open-location` (PR #5874)                                                                       | Carried in `main` including `4c3671905` memoized/capped-fence fixes (Groups 7–8)                                       |
| `origin/fix/5464-durable-user-image-history` (PR #5829 = `pr5829-sync`)                                               | Partially carried; rewind prune, no-echo steer, `importImage`, Pi image-only, Codex `imageView` absent (Group 5)       |
| `origin/fix/appimage-smoke-startup`                                                                                   | Unported: per-launch `TMPDIR` (`161e1eb95`); old `file-preview-unavailable` selector obsolete (Group 11)               |
| `origin/fix/fork-ci`, `origin/fix/linux-only-ci-budget`                                                               | Carried/superseded by current fork CI gating (Group 11)                                                                |
| `origin/fix/fork-release-publishing`                                                                                  | Superseded; current `desktop-release.yml` differs in manifest logic and dispatch defaults (Group 11)                   |
| `origin/fix/host-filter-lint`                                                                                         | Unported: `host-filter.tsx` lacks `useTranslation` subscription (Group 2)                                              |
| `local:feat/local-tts-piper-uk`                                                                                       | Speech models carried (Group 9); `303cdaa4f` 40-file UI i18n pass unported (Group 2)                                   |
| `local:feat/resource-link-opening`                                                                                    | Links/preflight carried; directory reveal (`5c040b859`/`d5dd090a9`) superseded by upstream `revealDirectory` (Group 8) |
| `local:fix/desktop-download`, `fix/download-active-connection`, `feat/download-toast-actions`, `fix/updater-epipe`    | Carried (Group 10); `3e5e6d09b` superseded by upstream `resolveDaemonDownloadTarget`                                   |
| `local:fix/spacing-port`                                                                                              | Superseded by carried spacing commits on `main` (Group 3)                                                              |
| `local:integrate/all-fixes`, `integrate/review-fixes`, `integrate/local-i18n-commits`, `integrate/shell-highlighting` | Superseded by v0.15 clean-base port, except the PR #5829 deltas noted in Group 5                                       |

### Outside the app-fork inventory

- Host-local Pi RPC timeout and model-queue settings (`knowledge/home/paseo/pi-rpc-boundary.md`), personal plugins (`user-images`, `undead-inference`), and Synology NAS deployment automation live outside this repository.
- Vault and Paseo agent-history searches (`journal/2026/10` had 34 Paseo-matching entries, `journal/2026/11` had 212; scoped message search hit `partial: true` at 20 agents; curated summaries were read for key feature agents `fd602130`, `6ec16f72`, `16d3c2a0`, `7ae7d8c1`, `f7e29a53`, `0361ed0e`, `7d553fa6`, `b94cab0b`, `1125fb19`, while `b4ba3d5f` and `1cd18875` returned empty activity). Those records provide context, not current-build acceptance.

---

## Post-merge verification checklist

After merging a newer upstream release tag into `main`, rebuild workspace declarations (`npm run build:server`), run `npm run typecheck` and `npm run lint`, and run targeted workspace tests (never run the full suite locally):

```bash
# Protocol & server (from repo root)
(cd packages/protocol && npx vitest run src/search/lang-match.test.ts src/messages.attachments.test.ts --bail=1)
(cd packages/server && npx vitest run src/server/agent/message-search/index.test.ts src/server/agent/conversation-image-store.test.ts src/server/agent/providers/pi/history-mapper.test.ts src/server/speech/providers/local/models.test.ts src/server/session/files/workspace-files-session.test.ts --bail=1)
(cd packages/highlight && npx vitest run src/__tests__/highlighter.test.ts --bail=1)

# App & desktop (run app tests from packages/app so __DEV__ setup loads)
(cd packages/app && npx vitest run src/i18n/resources.test.ts src/i18n/locales.test.ts src/appearance/apply.test.ts src/utils/sidebar-project-row-model.test.ts src/workspace-tabs/open-supporting-view.test.ts src/plugins/evaluate.test.ts src/runtime/replica-cache/index.test.ts src/components/rewind/composer-restore.provider.test.tsx --bail=1)
(cd packages/desktop && npx vitest run src/features/downloads.test.ts src/features/closed-output.test.ts src/features/opener.test.ts --bail=1)
node --test scripts/ci-workflow.test.mjs
```

### Manual smoke checks

- **Search:** In Command Center → **Messages**, search a distinctive phrase in fuzzy and exact modes, jump to an unloaded reply, and confirm host capability gating and `partial` hint behavior.
- **Localization:** Switch Settings → General → Language to **Українська**, verify host-picker labels and static date labels refresh, and inspect newly added upstream screens for English fallbacks.
- **Appearance & sidebar:** Adjust all four spacing sliders independently with an unsent draft and attachment open (verify neither is lost, check `review/surface.tsx` line height and settings sidebar scroll). Toggle single-workspace project flattening with both pinned and collapsed projects.
- **Links & terminals:** Test HTTP links under `chatLinkBehavior` (`ask` cancel opens nothing), a safe custom URI under `systemLinkBehavior`, a directory/oversized/unsupported file preview, and terminal open placement (**Main panel** vs **On the side**).
- **Images & Pi (isolated test workspace; do not restart production daemon):** Send an image with text, reload, rewind into an empty composer, and check restored attachment. In a disposable Pi session, compact, reload, and verify pre/post-compaction order and marker.
- **Desktop & plugins:** Verify inline code-block actions on complete and streaming blocks, main-process file download with **Open** / **Open folder** toast actions, packaged launch without attached output pipes, and 780 px provider sheet width on a wide window.
