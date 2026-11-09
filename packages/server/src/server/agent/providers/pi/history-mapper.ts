import { mapCustomMessageToToolCall } from "../custom-message.js";
import type { AgentStreamEvent, AgentTimelineItem, ToolCallDetail } from "../../agent-sdk-types.js";
import {
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

export interface PiHistoryMapperHooks {
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

export class PiHistoryMapper {
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

  private mapUserMessage(
    message: Extract<PiAgentMessage, { role: "user" }>,
    explicitId?: string,
    timestamp?: string,
  ): AgentStreamEvent[] {
    const text = getUserMessageText(message.content);
    this.userIndex += 1;
    if (!text) {
      return [];
    }
    const userEntry = this.userEntries[this.userIndex - 1];
    const messageId = explicitId ?? userEntry?.id;
    return [
      {
        type: "timeline",
        provider: this.provider,
        ...(timestamp ? { timestamp } : {}),
        item: {
          type: "user_message",
          text,
          ...(messageId ? { messageId } : {}),
        },
      },
    ];
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
): AsyncGenerator<AgentStreamEvent> {
  const mapper = new PiHistoryMapper(provider, userEntries, hooks, extensionHost);
  for (const message of messages) {
    if (signal?.aborted) return;
    for (const event of await mapper.mapMessages([message])) {
      if (signal?.aborted) return;
      yield event;
    }
  }
  for (const event of await mapper.hydrate()) {
    if (signal?.aborted) return;
    yield event;
  }
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
