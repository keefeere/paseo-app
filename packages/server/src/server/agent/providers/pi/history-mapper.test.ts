import { describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import {
  buildPiSessionPath,
  streamPiHistory,
  type PiCapturedUserMessageEntry,
} from "./history-mapper.js";
import type { PiAgentMessage, PiSessionEntry } from "./rpc-types.js";

async function collectHistory(
  messages: readonly (PiAgentMessage | PiSessionEntry)[],
  userEntries: PiCapturedUserMessageEntry[] = [],
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of streamPiHistory("pi", messages, userEntries)) {
    events.push(event);
  }
  return events;
}

describe("Pi history mapper", () => {
  test("renders visible custom messages as completed tools and hides private context", async () => {
    const events = await collectHistory([
      {
        role: "custom",
        customType: "project-context",
        content: "Project instructions",
        display: true,
      },
      {
        role: "custom",
        customType: "private-context",
        content: "Hidden instructions",
        display: false,
      },
      { role: "custom", customType: "project-context", content: "Project instructions" },
    ]);
    expect(events.map((event) => event.item)).toEqual(
      [1, 2].map((index) => ({
        type: "tool_call",
        callId: `pi-custom-${index}`,
        name: "project-context",
        status: "completed",
        detail: { type: "plain_text", text: "Project instructions" },
        metadata: { synthetic: true, customType: "project-context" },
        error: null,
      })),
    );
  });

  test("replays user, assistant, reasoning, and completed tool calls", async () => {
    await expect(
      collectHistory([
        {
          role: "user",
          content: [
            { type: "text", text: "read this" },
            { type: "image", data: "base64", mimeType: "image/png" },
            { type: "text", text: "then answer" },
          ],
        },
        {
          role: "assistant",
          responseId: "response-1",
          content: [
            { type: "thinking", thinking: "checking file" },
            { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "note.txt" } },
            { type: "text", text: "done" },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "read this\n\nthen answer",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "reasoning", text: "checking file" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "running",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: undefined,
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: "done", messageId: "response-1" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "completed",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: "file contents",
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
    ]);
  });

  test("replays bash execution records as completed shell calls", async () => {
    await expect(
      collectHistory([
        {
          role: "bashExecution",
          command: "echo hi",
          output: "hi\n",
          exitCode: 0,
          timestamp: 123,
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "pi-bash-123",
          name: "bash",
          status: "completed",
          detail: { type: "shell", command: "echo hi", output: "hi\n", exitCode: 0 },
          error: null,
        },
      },
    ]);
  });

  test("replays custom messages as completed tools, matching the live path", async () => {
    await expect(
      collectHistory([{ role: "custom", content: "Extension command output" }]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "pi-custom-1",
          name: "custom-message",
          status: "completed",
          detail: { type: "plain_text", text: "Extension command output" },
          metadata: { synthetic: true, customType: "custom-message" },
          error: null,
        },
      },
    ]);
  });

  test("uses Pi tree entry ids for replayed user messages", async () => {
    await expect(
      collectHistory(
        [
          { role: "user", content: "first prompt" },
          { role: "assistant", content: [{ type: "text", text: "first answer" }] },
          { role: "user", content: "second prompt" },
        ],
        [
          { id: "entry-user-1", text: "first prompt" },
          { id: "entry-user-2", text: "second prompt" },
        ],
      ),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "first prompt",
          messageId: "entry-user-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "assistant_message",
          text: "first answer",
          messageId: "pi-history-assistant-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "second prompt",
          messageId: "entry-user-2",
        },
      },
    ]);
  });
});

describe("Pi tool-result image replay", () => {
  test("recreates an image from native tool-result history without its source file", async () => {
    const events = await collectHistory([
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "image-read",
            name: "read",
            arguments: { path: "missing-preview.png" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "image-read",
        toolName: "read",
        content: [
          { type: "text", text: "Read image file [image/png]" },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        ],
      },
    ]);
    expect(events.map((event) => event.item?.type)).toEqual([
      "tool_call",
      "tool_call",
      "assistant_message",
    ]);
    const image = events.find(
      (event) => event.type === "timeline" && event.item.type === "assistant_message",
    );
    expect(image).toMatchObject({
      type: "timeline",
      item: { type: "assistant_message", text: expect.stringContaining("![Image](file://") },
    });
    if (image?.type !== "timeline" || image.item.type !== "assistant_message")
      throw new Error("Missing image");
    const url = image.item.text.match(/\((file:[^)]+)\)/)![1];
    const { readFile, unlink } = await import("node:fs/promises");
    expect(await readFile(new URL(url))).toEqual(Buffer.from("hello"));
    await unlink(new URL(url));
    const replay = await collectHistory([
      {
        role: "toolResult",
        toolCallId: "image-read",
        toolName: "read",
        content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
      },
    ]);
    expect(replay).toContainEqual(image);
    expect(await readFile(new URL(url))).toEqual(Buffer.from("hello"));
  });
});

test("replayed Pi images keep their position before the following reply", async () => {
  const events = await collectHistory([
    {
      role: "toolResult",
      toolCallId: "image-position",
      toolName: "read",
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    },
    { role: "assistant", content: [{ type: "text", text: "Image read complete." }] },
  ]);
  expect(
    events.map((event) =>
      event.item?.type === "assistant_message" ? event.item.text : event.item?.type,
    ),
  ).toEqual(["tool_call", expect.stringContaining("![Image]("), "Image read complete."]);
});

describe("buildPiSessionPath", () => {
  test("reconstructs branch path from root to leaf via parentId", () => {
    const entries: PiSessionEntry[] = [
      { type: "session", id: "sess-1", parentId: null },
      {
        type: "message",
        id: "m1",
        parentId: "sess-1",
        message: { role: "user", content: "hello" },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      },
      // Branch off m1 that is not on the active leaf
      {
        type: "message",
        id: "m2-alt",
        parentId: "m1",
        message: { role: "assistant", content: [{ type: "text", text: "alt reply" }] },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "m2",
        summary: "summary",
        tokensBefore: 50000,
      },
      {
        type: "message",
        id: "m3",
        parentId: "c1",
        message: { role: "user", content: "what next" },
      },
    ];

    const path = buildPiSessionPath(entries, "m3");
    expect(path.map((e) => e.id)).toEqual(["sess-1", "m1", "m2", "c1", "m3"]);
  });

  test("applies context edits along the path", () => {
    const entries: PiSessionEntry[] = [
      {
        type: "message",
        id: "m1",
        parentId: null,
        message: { role: "user", content: "old text" },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        message: { role: "assistant", content: [{ type: "text", text: "failed" }] },
      },
      {
        type: "context_edit",
        id: "e1",
        parentId: "m2",
        targetId: "m2",
        replacement: null, // retracted
      },
      {
        type: "context_edit",
        id: "e2",
        parentId: "e1",
        targetId: "m1",
        replacement: { content: "edited text" },
      },
      {
        type: "message",
        id: "m3",
        parentId: "e2",
        message: { role: "assistant", content: [{ type: "text", text: "success" }] },
      },
    ];

    const path = buildPiSessionPath(entries, "m3");
    expect(path.map((e) => e.id)).toEqual(["m1", "m3"]);
    expect(path[0]?.type === "message" && path[0].message.content).toBe("edited text");
  });
});

describe("Pi session entries replay with compaction", () => {
  test("replays pre-compaction and post-compaction messages with compaction timeline item", async () => {
    const entries: PiSessionEntry[] = [
      {
        type: "message",
        id: "user-entry-1",
        timestamp: "2026-11-01T10:00:00Z",
        message: { role: "user", content: "first question" },
      },
      {
        type: "message",
        id: "assistant-entry-1",
        timestamp: "2026-11-01T10:00:05Z",
        message: {
          role: "assistant",
          responseId: "resp-1",
          content: [{ type: "text", text: "first answer" }],
        },
      },
      {
        type: "compaction",
        id: "compaction-entry-1",
        timestamp: "2026-11-02T12:00:00Z",
        summary: "Summary of discussion",
        tokensBefore: 120500,
        fromHook: false,
      },
      {
        type: "message",
        id: "user-entry-2",
        timestamp: "2026-11-03T09:00:00Z",
        message: { role: "user", content: "second question after compaction" },
      },
      {
        type: "message",
        id: "assistant-entry-2",
        timestamp: "2026-11-03T09:00:08Z",
        message: {
          role: "assistant",
          responseId: "resp-2",
          content: [{ type: "text", text: "second answer" }],
        },
      },
    ];

    const events = await collectHistory(entries);

    expect(events).toEqual([
      {
        type: "timeline",
        provider: "pi",
        timestamp: "2026-11-01T10:00:00Z",
        item: {
          type: "user_message",
          text: "first question",
          messageId: "user-entry-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        timestamp: "2026-11-01T10:00:05Z",
        item: {
          type: "assistant_message",
          text: "first answer",
          messageId: "resp-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        timestamp: "2026-11-02T12:00:00Z",
        item: {
          type: "compaction",
          status: "completed",
          preTokens: 120500,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        timestamp: "2026-11-03T09:00:00Z",
        item: {
          type: "user_message",
          text: "second question after compaction",
          messageId: "user-entry-2",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        timestamp: "2026-11-03T09:00:08Z",
        item: {
          type: "assistant_message",
          text: "second answer",
          messageId: "resp-2",
        },
      },
    ]);
  });

  test("replays the whole branch when a compaction leaves no user message after it", async () => {
    // The shape that made the chat look empty: the last compaction kept only
    // assistant/toolResult rows, so get_messages reported no user message at all.
    const entries: PiSessionEntry[] = [
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-11-01T09:00:00Z",
        message: { role: "user", content: "the only question" },
      },
      {
        type: "message",
        id: "assistant-1",
        timestamp: "2026-11-01T09:00:05Z",
        message: {
          role: "assistant",
          responseId: "r1",
          content: [
            { type: "text", text: "working" },
            { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } },
          ],
        },
      },
      {
        type: "message",
        id: "tool-1",
        timestamp: "2026-11-01T09:00:06Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "bash",
          content: [{ type: "text", text: "a.md" }],
          details: { command: "ls", output: "a.md", exitCode: 0 },
        },
      },
      {
        type: "compaction",
        id: "c-1",
        timestamp: "2026-11-01T09:30:00Z",
        summary: "Summary",
        firstKeptEntryId: "assistant-1",
        tokensBefore: 90000,
      },
    ];

    const events = await collectHistory(entries, []);
    expect(events.map((event) => event.item.type)).toEqual([
      "user_message",
      "assistant_message",
      "tool_call",
      "tool_call",
      "compaction",
    ]);
  });

  test("skips session entries the model context does not carry", async () => {
    const entries: PiSessionEntry[] = [
      { type: "session", id: "sess-1", timestamp: "2026-11-01T09:00:00Z" },
      { type: "model_change", id: "mc-1", timestamp: "2026-11-01T09:00:01Z" },
      {
        type: "message",
        id: "sys-1",
        timestamp: "2026-11-01T09:00:02Z",
        message: { role: "system", content: [{ type: "text", text: "system prompt" }] },
      },
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-11-01T09:00:03Z",
        message: { role: "user", content: "hello" },
      },
    ];

    const events = await collectHistory(entries, []);
    expect(events.map((event) => event.item.type)).toEqual(["user_message"]);
  });
});
