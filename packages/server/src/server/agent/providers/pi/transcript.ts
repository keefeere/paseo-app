import { z } from "zod";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { MAX_RECOVERED_IMAGE_BYTES } from "../../provider-image-recovery.js";
import { getUserMessageText, type PiCapturedUserMessageEntry } from "./history-mapper.js";
import type { PiAgentMessage, PiSessionEntry } from "./rpc-types.js";

export interface PiTranscript {
  recoverImage?: (
    entryId: string,
    index: number,
  ) => (() => Promise<{ data: string; mimeType: string }>) | undefined;
  messages: PiAgentMessage[];
  userEntries: PiCapturedUserMessageEntry[];
  /**
   * The active branch records in chronological order, including compaction entries.
   * Replay needs them to mark where the context was compacted; `messages` skips them.
   */
  entries: PiSessionEntry[];
  /**
   * Every user-message entry in the file, including ones off the active branch. Rewind
   * navigates the tree by entry id, so it needs ids the branch replay never shows.
   */
  treeEntries: Array<PiCapturedUserMessageEntry & { parentId: string | null }>;
}

const text = z.object({ type: z.literal("text"), text: z.string() }).passthrough();
const image = z
  .object({ type: z.literal("image"), data: z.string(), mimeType: z.string() })
  .passthrough();
const content = z.union([z.string(), z.array(z.union([text, image]))]);
const userMessage = z.object({ role: z.literal("user"), content }).passthrough();
const message = z.discriminatedUnion("role", [
  z
    .object({ role: z.literal("system"), content: z.union([z.string(), z.array(text)]).nullish() })
    .passthrough(),
  z.object({ role: z.literal("branchSummary"), summary: z.string() }).passthrough(),
  z.object({ role: z.literal("compactionSummary"), summary: z.string() }).passthrough(),
  z.object({ role: z.literal("user"), content }).passthrough(),
  z
    .object({
      role: z.literal("custom"),
      content,
      customType: z.string().optional(),
      display: z.boolean().optional(),
      details: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.array(
        z.union([
          text,
          z.object({ type: z.literal("thinking"), thinking: z.string() }).passthrough(),
          z
            .object({
              type: z.literal("toolCall"),
              id: z.string(),
              name: z.string(),
              arguments: z.unknown(),
            })
            .passthrough(),
        ]),
      ),
    })
    .passthrough(),
  z
    .object({
      role: z.literal("toolResult"),
      toolCallId: z.string(),
      toolName: z.string(),
      content: z.unknown(),
      isError: z.boolean().optional(),
      details: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      role: z.literal("bashExecution"),
      command: z.string(),
      output: z.string().optional(),
      exitCode: z.number().nullable().optional(),
      cancelled: z.boolean().optional(),
      timestamp: z.number(),
    })
    .passthrough(),
]);
const record = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    parentId: z.string().nullable().optional(),
    message: z.unknown().optional(),
  })
  .passthrough();

const MAX_RECOVERY_LINE_BYTES = Math.ceil(MAX_RECOVERED_IMAGE_BYTES / 3) * 4 + 1024 * 1024;

export async function readPiTranscriptFile(file: string): Promise<PiTranscript> {
  return readPiTranscript(await readFile(file, "utf8"), file);
}

function parseRecords(contents: string, indexLocations: boolean) {
  const records: z.infer<typeof record>[] = [];
  const locations = new Map<string, { offset: number; length: number }>();
  let offset = 0;
  for (const line of contents.split("\n")) {
    const length = indexLocations ? Buffer.byteLength(line) : 0;
    if (line.trim()) {
      const entry = record.parse(JSON.parse(line));
      records.push(entry);
      if (
        indexLocations &&
        entry.type === "message" &&
        entry.id &&
        length <= MAX_RECOVERY_LINE_BYTES
      ) {
        locations.set(entry.id, { offset, length });
      }
    }
    offset += length + 1;
  }
  return { records, locations };
}

/** Select the persisted active ancestry, retaining structural links across compaction. */
export function readPiTranscript(contents: string, file?: string): PiTranscript {
  const { records, locations } = parseRecords(contents, file !== undefined);
  const header = records.shift();
  if (header?.type !== "session") throw new Error("Pi transcript is missing its session header");
  const legacy = header.version === 1;
  const branch = legacy ? records : activeBranch(records);
  const result: PiTranscript = { messages: [], userEntries: [], entries: [], treeEntries: [] };
  for (const entry of records) {
    if (entry.type !== "message") continue;
    const parsedUser = userMessage.safeParse(entry.message);
    if (parsedUser.success && entry.id) {
      result.treeEntries.push({
        id: entry.id,
        parentId: entry.parentId ?? null,
        text: getUserMessageText(parsedUser.data.content),
      });
    }
  }
  for (const entry of branch) {
    if (entry.type === "compaction") {
      // Compaction rows carry no display message, but the replay marks them.
      result.entries.push(entry as unknown as PiSessionEntry);
      continue;
    }
    if (entry.type !== "message" && entry.type !== "custom_message") continue;
    const parsed = message.parse(
      entry.type === "custom_message" ? { ...entry, role: "custom" } : entry.message,
    );
    // These native context messages had no display mapping in get_messages replay.
    if (
      parsed.role === "system" ||
      parsed.role === "branchSummary" ||
      parsed.role === "compactionSummary"
    )
      continue;
    result.entries.push(entry as unknown as PiSessionEntry);
    result.messages.push(parsed);
    if (parsed.role === "user" && entry.id)
      result.userEntries.push({
        id: entry.id,
        text: getUserMessageText(parsed.content),
      });
  }
  if (file) {
    result.recoverImage = (entryId, index) => {
      const location = locations.get(entryId);
      return location ? () => readImageBlock(file, location, entryId, index) : undefined;
    };
  }
  return result;
}

async function readImageBlock(
  file: string,
  { offset, length }: { offset: number; length: number },
  entryId: string,
  index: number,
) {
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || offset + length > stat.size)
      throw new Error("Pi transcript entry is unavailable");
    const { buffer, bytesRead } = await handle.read({
      buffer: Buffer.allocUnsafe(length),
      position: offset,
    });
    if (bytesRead !== length) throw new Error("Pi transcript entry is incomplete");
    const entry = record.parse(JSON.parse(buffer.toString("utf8")));
    const user = userMessage.parse(entry.message);
    if (entry.type !== "message" || entry.id !== entryId || !Array.isArray(user.content)) {
      throw new Error("Pi transcript entry changed since replay");
    }
    return image.parse(user.content[index]);
  } finally {
    await handle.close();
  }
}

function activeBranch(records: z.infer<typeof record>[]): z.infer<typeof record>[] {
  const byId = new Map<string, (typeof records)[number]>();
  for (const entry of records) {
    if (!entry.id || entry.parentId === undefined || byId.has(entry.id))
      throw new Error("Invalid Pi transcript tree entry");
    byId.set(entry.id, entry);
  }
  const branch: z.infer<typeof record>[] = [];
  const seen = new Set<string>();
  let entry = records.at(-1);
  while (entry) {
    const id = entry.id!;
    if (seen.has(id)) throw new Error("Cycle in Pi transcript ancestry");
    seen.add(id);
    branch.push(entry);
    if (entry.parentId === null) break;
    entry = byId.get(entry.parentId!);
    if (!entry) throw new Error("Missing Pi transcript ancestor");
  }
  branch.reverse();
  return branch;
}
