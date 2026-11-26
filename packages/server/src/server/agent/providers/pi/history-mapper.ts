import { mapCustomMessageToToolCall } from "../custom-message.js";
import type {
  AgentHistoryOptions,
  AgentMetric,
  AgentTimelineImage,
  AgentStreamEvent,
  AgentTimelineItem,
  ToolCallDetail,
} from "../../agent-sdk-types.js";
import type { MeasuredStep } from "../turn-metrics.js";
import { piReplayedTurns } from "./metrics.js";
import {
  MAX_PROVIDER_IMAGE_BYTES,
  materializeProviderImage,
  renderProviderImageOutputAsAssistantMarkdown,
} from "../provider-image-output.js";
import {
  createPiExtensionHost,
  type PiExtensionEventOutput,
  type PiExtensionHost,
} from "./extensions/index.js";
import type {
  PiAgentMessage,
  PiCompactionSessionEntry,
  PiContextEditSessionEntry,
  PiImageContent,
  PiSessionEntry,
  PiTextContent,
} from "./rpc-types.js";
import {
  isPiCompactionSessionEntry,
  isPiContextEditSessionEntry,
  isPiMessageSessionEntry,
} from "./rpc-types.js";
import {
  extractTextFromToolResult,
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  splitPiToolResultImages,
  type PiToolResult,
  type PiTrackedToolCall,
} from "./tool-call-mapper.js";

export interface PiCapturedUserMessageEntry {
  id: string;
  text: string;
}

export interface PiHistoryMapperHooks extends AgentHistoryOptions {
  onUserImageError?: (error: unknown) => void;
  mapCustomMessage?: (
    text: string,
    provider: string,
  ) => Extract<AgentStreamEvent, { type: "timeline" }> | null;
  resolveToolCallId?: (toolCallId: string, toolCall: PiTrackedToolCall) => string;
  mapToolDetail?: (
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
    context: { toolCallId: string },
  ) => ToolCallDetail | null;
}

function isTextContentBlock(block: unknown): block is PiTextContent {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    Reflect.get(block, "type") === "text" &&
    typeof Reflect.get(block, "text") === "string"
  );
}

export function getUserMessageText(content: string | (PiTextContent | PiImageContent)[]): string {
  if (typeof content === "string") {
    return content;
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (isTextContentBlock(block)) {
      textParts.push(block.text);
    }
  }
  return textParts.join("\n\n");
}

export function isPiSessionEntry(item: PiAgentMessage | PiSessionEntry): item is PiSessionEntry {
  return typeof item === "object" && item !== null && "type" in item && !("role" in item);
}

function applyPathContextEdit(
  entry: PiSessionEntry,
  edit: PiContextEditSessionEntry | undefined,
): PiSessionEntry | null {
  if (!edit) return entry;
  if (edit.replacement === null) return null;
  if (!isPiMessageSessionEntry(entry)) return entry;
  const replacement = edit.replacement as { content?: unknown } | null;
  if (replacement && typeof replacement === "object" && replacement.content !== undefined) {
    return {
      ...entry,
      message: {
        ...entry.message,
        content:
          typeof replacement.content === "string"
            ? replacement.content
            : (replacement.content as (PiTextContent | PiImageContent)[]),
      },
    };
  }
  return entry;
}

export function buildPiSessionPath(
  entries: readonly PiSessionEntry[],
  leafId: string | null,
): PiSessionEntry[] {
  if (entries.length === 0) return [];
  const byId = new Map<string, PiSessionEntry>();
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
  }
  const leaf = (leafId ? byId.get(leafId) : undefined) ?? entries[entries.length - 1];
  if (!leaf) return [];

  const rawPath: PiSessionEntry[] = [];
  const visited = new Set<string>();
  let current: PiSessionEntry | undefined = leaf;
  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id);
    rawPath.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  rawPath.reverse();

  const edits = new Map<string, PiContextEditSessionEntry>();
  for (const entry of rawPath) {
    if (isPiContextEditSessionEntry(entry)) {
      edits.set(entry.targetId, entry);
    }
  }

  const finalPath: PiSessionEntry[] = [];
  for (const entry of rawPath) {
    if (isPiContextEditSessionEntry(entry)) continue;
    const resolved = applyPathContextEdit(entry, entry.id ? edits.get(entry.id) : undefined);
    if (resolved) finalPath.push(resolved);
  }

  return finalPath;
}

// Count small blocks as well as bytes: each image can require hashing and filesystem operations.
const MAX_REPLAY_USER_IMAGES = 256;
const MAX_REPLAY_IMAGE_CHARACTERS = Math.ceil(MAX_PROVIDER_IMAGE_BYTES / 3) * 4 + 256;

export class PiHistoryMapper {
  private remainingImageBlocks = MAX_REPLAY_USER_IMAGES;
  private remainingImageCharacters = MAX_REPLAY_IMAGE_CHARACTERS;
  private reportedImageBudget = false;
  private readonly pendingToolCalls = new Map<string, PiTrackedToolCall>();
  private readonly hydrations: Promise<AgentStreamEvent[]>[] = [];
  private userIndex = 0;
  private assistantIndex = 0;
  private customIndex = 0;

  constructor(
    private readonly provider: string,
    private readonly userEntries: readonly PiCapturedUserMessageEntry[] = [],
    private readonly hooks: PiHistoryMapperHooks = {},
    private readonly extensionHost: PiExtensionHost = createPiExtensionHost(),
  ) {}

  async mapMessages(
    items: readonly (PiAgentMessage | PiSessionEntry)[],
  ): Promise<AgentStreamEvent[]> {
    const events: AgentStreamEvent[] = [];

    for (const item of items) {
      if (isPiSessionEntry(item)) {
        if (isPiCompactionSessionEntry(item)) {
          events.push(...this.mapCompactionEntry(item));
        } else if (isPiMessageSessionEntry(item)) {
          events.push(...(await this.mapSingleMessage(item.message, item.id, item.timestamp)));
        }
      } else {
        events.push(...(await this.mapSingleMessage(item)));
      }
    }

    return events;
  }

  async hydrate(): Promise<AgentStreamEvent[]> {
    return (await Promise.all(this.hydrations)).flat();
  }

  private async mapSingleMessage(
    message: PiAgentMessage,
    explicitId?: string,
    timestamp?: string,
  ): Promise<AgentStreamEvent[]> {
    switch (message.role) {
      case "user":
        return this.mapUserMessage(message, explicitId, timestamp);
      case "custom":
        return this.mapCustomMessage(message, explicitId, timestamp);
      case "assistant":
        return this.mapAssistantMessage(message, explicitId, timestamp);
      case "toolResult":
        return await this.mapToolResultMessage(message, explicitId, timestamp);
      case "bashExecution":
        return [this.mapBashExecutionMessage(message, explicitId, timestamp)];
      default:
        // Session-wide entries outside the model context, e.g. pi's system prompts.
        return [];
    }
  }

  private mapCompactionEntry(entry: PiCompactionSessionEntry): AgentStreamEvent[] {
    return [
      {
        type: "timeline",
        provider: this.provider,
        ...(entry.timestamp ? { timestamp: entry.timestamp } : {}),
        // Pi session entries record no auto/manual reason, so report only the size
        // the compaction replaced. The summary text stays out of the wire item:
        // CompactionTimelineItem has no summary field in the protocol.
        item: {
          type: "compaction",
          status: "completed",
          preTokens: typeof entry.tokensBefore === "number" ? entry.tokensBefore : undefined,
        },
      },
    ];
  }

  private async mapUserMessage(
    message: Extract<PiAgentMessage, { role: "user" }>,
    explicitId?: string,
    timestamp?: string,
  ): Promise<AgentStreamEvent[]> {
    const text = getUserMessageText(message.content);
    const userEntry = this.userEntries[this.userIndex++];
    const messageId = explicitId ?? userEntry?.id;
    const submitted = messageId ? this.hooks.findSubmittedUserImages?.(messageId) : undefined;
    const images = await this.materializeUserImages(message.content, submitted ?? []);
    if (!text && !images.length) return [];
    return [
      {
        type: "timeline",
        provider: this.provider,
        ...(timestamp ? { timestamp } : {}),
        item: {
          type: "user_message",
          text,
          ...(messageId ? { messageId } : {}),
          ...(images.length ? { images } : {}),
        },
      },
    ];
  }

  private async materializeUserImages(
    content: Extract<PiAgentMessage, { role: "user" }>["content"],
    submitted: AgentTimelineImage[],
  ): Promise<AgentTimelineImage[]> {
    if (!Array.isArray(content)) return submitted;
    if (submitted.length) {
      let nativeCount = 0;
      for (const block of content) {
        if (block?.type === "image" && ++nativeCount > submitted.length) break;
      }
      // A complete daemon list is authoritative; Pi may have resized or filtered those images.
      if (nativeCount <= submitted.length) return submitted;
    }

    const images: AgentTimelineImage[] = [];
    const submittedById = new Map<string, number[]>();
    const used = new Set<number>();
    for (const [index, image] of submitted.entries()) {
      const indexes = submittedById.get(image.id);
      if (indexes) indexes.push(index);
      else submittedById.set(image.id, [index]);
    }
    for (const block of content) {
      if (block?.type !== "image") continue;
      if (this.remainingImageBlocks === 0) {
        this.reportImageBudget();
        break;
      }
      const input = this.claimUserImageInput(block);
      if (!input) continue;
      try {
        let matched: number | undefined;
        const { path, id, mimeType, byteSize } = await materializeProviderImage({
          ...input,
          reusePath: (hash) => {
            matched = submittedById.get(hash)?.shift();
            return matched === undefined ? undefined : submitted[matched].source;
          },
        });
        if (matched !== undefined) {
          used.add(matched);
          images.push(submitted[matched]);
        } else if (byteSize && mimeType.startsWith("image/")) {
          images.push({ id, mimeType, source: path, byteSize });
        }
      } catch (error) {
        this.hooks.onUserImageError?.(error);
      }
    }
    // If the daemon only saved some attachments and Pi changed the bytes, the
    // transcript carries no association for safe positional deduplication.
    return [...images, ...submitted.filter((_, index) => !used.has(index))];
  }

  private claimUserImageInput(block: PiImageContent): { data: string; mimeType: string } | null {
    this.remainingImageBlocks -= 1;
    const { data, mimeType } = block;
    if (
      typeof data !== "string" ||
      !data ||
      typeof mimeType !== "string" ||
      !mimeType.startsWith("image/")
    ) {
      return null;
    }
    if (data.length > this.remainingImageCharacters) {
      this.reportImageBudget();
      return null;
    }
    this.remainingImageCharacters -= data.length;
    return { data, mimeType };
  }

  private reportImageBudget(): void {
    if (this.reportedImageBudget) return;
    this.reportedImageBudget = true;
    this.hooks.onUserImageError?.(new Error("Pi history user image replay budget exceeded"));
  }

  private mapCustomMessage(
    message: Extract<PiAgentMessage, { role: "custom" }>,
    explicitId?: string,
    timestamp?: string,
  ): AgentStreamEvent[] {
    const extensionMapping = this.extensionHost.mapCustomMessage(message);
    const extensionEvents = this.extensionEvents(extensionMapping);
    if (message.display === false) return extensionEvents;
    const text = getUserMessageText(message.content);
    const mappedEvent = text ? this.hooks.mapCustomMessage?.(text, this.provider) : null;
    if (mappedEvent) {
      return [...extensionEvents, mappedEvent];
    }
    return [
      ...extensionEvents,
      ...(text
        ? [
            {
              type: "timeline",
              provider: this.provider,
              ...(timestamp ? { timestamp } : {}),
              item: mapCustomMessageToToolCall(
                message,
                text,
                explicitId ?? `${this.provider}-custom-${++this.customIndex}`,
              ),
            } as AgentStreamEvent,
          ]
        : []),
    ];
  }

  private mapAssistantMessage(
    message: Extract<PiAgentMessage, { role: "assistant" }>,
    explicitId?: string,
    timestamp?: string,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    this.assistantIndex += 1;
    const messageId =
      message.responseId ||
      explicitId ||
      `${this.provider}-history-assistant-${this.assistantIndex}`;
    for (const content of message.content) {
      if (content.type === "text" && content.text) {
        events.push({
          type: "timeline",
          provider: this.provider,
          ...(timestamp ? { timestamp } : {}),
          item: { type: "assistant_message", text: content.text, messageId },
        });
        continue;
      }
      if (content.type === "thinking" && content.thinking) {
        events.push({
          type: "timeline",
          provider: this.provider,
          ...(timestamp ? { timestamp } : {}),
          item: { type: "reasoning", text: content.thinking },
        });
        continue;
      }
      if (content.type === "toolCall") {
        const tracked = parseToolArgs(content.name, content.arguments);
        this.pendingToolCalls.set(content.id, tracked);
        const mapping = this.extensionHost.mapToolCall({
          callId: content.id,
          toolName: tracked.toolName,
          args: tracked.args,
          status: "running",
          result: null,
        });
        const detail = this.mapToolDetail(content.id, tracked, null, mapping?.detail);
        if (!detail) {
          continue;
        }
        events.push({
          type: "timeline",
          provider: this.provider,
          ...(timestamp ? { timestamp } : {}),
          item: {
            type: "tool_call",
            callId: this.resolveToolCallId(content.id, tracked),
            name: mapping?.name ?? tracked.toolName,
            status: "running",
            detail,
            error: null,
          },
        });
        events.push(...this.extensionEvents(mapping));
      }
    }
    return events;
  }

  private async mapToolResultMessage(
    message: Extract<PiAgentMessage, { role: "toolResult" }>,
    _explicitId?: string,
    timestamp?: string,
  ): Promise<AgentStreamEvent[]> {
    const tracked =
      this.pendingToolCalls.get(message.toolCallId) ?? parseToolArgs(message.toolName, null);
    this.pendingToolCalls.delete(message.toolCallId);
    const result = parseToolResult({ content: message.content, details: message.details });
    // Pull image blocks out of the result so base64 never reaches the tool output, then render
    // each one as an assistant_message markdown image after the tool_call (mirroring the live
    // path and the Claude provider, upstream #1717).
    const { images, result: splitResult } = splitPiToolResultImages(result);
    const mapping = this.extensionHost.mapToolCall({
      callId: message.toolCallId,
      toolName: tracked.toolName,
      args: tracked.args,
      status: message.isError ? "failed" : "completed",
      result: splitResult,
    });
    const detail = this.mapToolDetail(message.toolCallId, tracked, splitResult, mapping?.detail);
    if (!detail) {
      return [];
    }
    const imageEvents: AgentStreamEvent[] = [];
    for (const image of images) {
      const item = await renderProviderImageOutputAsAssistantMarkdown(image, {
        materialize: materializeProviderImage,
      });
      if (item)
        imageEvents.push({
          type: "timeline",
          provider: this.provider,
          ...(timestamp ? { timestamp } : {}),
          item,
        });
    }
    return [
      {
        type: "timeline",
        provider: this.provider,
        ...(timestamp ? { timestamp } : {}),
        item: toToolResultTimelineItem({
          callId: this.resolveToolCallId(message.toolCallId, tracked),
          name: mapping?.name ?? tracked.toolName,
          isError: Boolean(message.isError),
          detail,
          errorText: extractTextFromToolResult(splitResult) ?? "Tool call failed",
        }),
      },
      ...imageEvents,
      ...this.extensionEvents(mapping),
    ];
  }

  private extensionEvents(mapping: PiExtensionEventOutput | undefined): AgentStreamEvent[] {
    if (!mapping) return [];
    this.hydrations.push(mapping.hydration);
    return mapping.events;
  }

  private mapBashExecutionMessage(
    message: Extract<PiAgentMessage, { role: "bashExecution" }>,
    explicitId?: string,
    timestamp?: string,
  ): AgentStreamEvent {
    const detail: ToolCallDetail = {
      type: "shell",
      command: message.command,
      output: message.output,
      exitCode: message.exitCode ?? null,
    };
    return {
      type: "timeline",
      provider: this.provider,
      ...(timestamp ? { timestamp } : {}),
      item: {
        type: "tool_call",
        callId: explicitId ?? `pi-bash-${message.timestamp}`,
        name: "bash",
        status: message.cancelled ? "canceled" : "completed",
        detail,
        error: null,
      },
    };
  }

  private resolveToolCallId(toolCallId: string, toolCall: PiTrackedToolCall): string {
    return this.hooks.resolveToolCallId?.(toolCallId, toolCall) ?? toolCallId;
  }

  private mapToolDetail(
    toolCallId: string,
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
    extensionDetail?: ToolCallDetail,
  ): ToolCallDetail | null {
    const hook = this.hooks.mapToolDetail;
    return hook
      ? hook(toolCall, result, { toolCallId })
      : (extensionDetail ?? mapToolDetail(toolCall, result));
  }
}

export async function* streamPiHistory(
  provider: string,
  messages: readonly (PiAgentMessage | PiSessionEntry)[],
  userEntries: readonly PiCapturedUserMessageEntry[] = [],
  hooks: PiHistoryMapperHooks = {},
  // At most eight 2 MiB child files per replay; remaining cards keep their summaries.
  extensionHost: PiExtensionHost = createPiExtensionHost(undefined, undefined, 16 * 1024 * 1024),
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent, PiHistoryReplay> {
  const mapper = new PiHistoryMapper(provider, userEntries, hooks, extensionHost);
  const turns = piReplayedTurns();
  const replay: PiHistoryReplay = { lastReply: null };
  // Each finished turn's metrics follow its rows, as they do live.
  const turnCompleted = (metrics: AgentMetric[]): AgentStreamEvent[] =>
    metrics.length ? [{ type: "turn_completed", provider, metrics }] : [];
  for (const message of messages) {
    if (signal?.aborted) return replay;
    let replayMessage: PiAgentMessage | null = null;
    if (isPiSessionEntry(message)) {
      if (isPiMessageSessionEntry(message)) replayMessage = message.message;
    } else {
      replayMessage = message;
    }
    const events = [
      ...(replayMessage ? turnCompleted(turns.observe(replayMessage)) : []),
      ...(await mapper.mapMessages([message])),
    ];
    for (const event of events) {
      if (signal?.aborted) return replay;
      yield event;
    }
  }
  yield* turnCompleted(turns.end());
  replay.lastReply = turns.lastReply;
  for (const event of await mapper.hydrate()) {
    if (signal?.aborted) return replay;
    yield event;
  }
  return replay;
}

export interface PiHistoryReplay {
  /** The most recent reply replayed, for the session's metrics. */
  lastReply: MeasuredStep | null;
}

function toToolResultTimelineItem(input: {
  callId: string;
  name: string;
  isError: boolean;
  detail: ToolCallDetail;
  errorText: string;
}): AgentTimelineItem {
  if (input.isError) {
    return {
      type: "tool_call",
      callId: input.callId,
      name: input.name,
      status: "failed",
      detail: input.detail,
      error: input.errorText,
    };
  }
  return {
    type: "tool_call",
    callId: input.callId,
    name: input.name,
    status: "completed",
    detail: input.detail,
    error: null,
  };
}
