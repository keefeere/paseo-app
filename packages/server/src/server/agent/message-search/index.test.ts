import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import {
  buildSearchableMessages,
  isMessageSearchIndexFresh,
  matchMessageText,
  queueMessageSearchIndexWarm,
  searchAgentMessages,
  searchCachedAgentMessages,
} from "./index.js";

function rows(items: AgentTimelineItem[]) {
  return items.map((item, index) => ({ item, seq: index + 1, timestamp: "2026-09-12T00:00:00Z" }));
}

it("finds a declined word form the exact phrase search misses", async () => {
  const result = await searchAgentMessages(
    rows([
      { type: "user_message", text: "А яка максимально бюджетна модель для локального запуску?" },
      { type: "user_message", text: "unrelated note about budgets" },
    ]),
    "який максимально",
  );
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]?.seq).toBe(1);
  expect(result.hits[0]?.role).toBe("user");
});

it("does not care which order the recalled words came in", async () => {
  const result = await searchAgentMessages(
    rows([{ type: "assistant_message", text: "Рендер структурованих блоків дорогий." }]),
    "дорогий рендері",
  );
  expect(result.hits[0]?.seq).toBe(1);
});

it("marks the words the query landed on, inside the snippet", async () => {
  const hit = matchMessageText("який максимально", [
    "А яка максимально бюджетна модель для локального запуску?",
  ]);
  expect(hit).not.toBeNull();
  const marked = hit!.ranges.map((range) =>
    hit!.block.slice(range.start, range.start + range.length),
  );
  expect(marked).toEqual(["яка", "максимально"]);
});

it("searches rendered assistant text and skips tools and reasoning", async () => {
  const result = await searchAgentMessages(
    rows([
      { type: "assistant_message", text: "Використовуємо **гідратацію** під час startup." },
      { type: "reasoning", text: "гідратацію" },
      { type: "tool_call", toolName: "bash", callId: "c1", args: { command: "гідратацію" } },
    ]),
    "гідратація",
  );
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]?.seq).toBe(1);
});

it("caps hits per agent and reports an unfinished scan", async () => {
  const source = rows(Array.from({ length: 30 }, () => ({ type: "user_message", text: "target" })));
  const capped = await searchAgentMessages(source, "target", { limit: 2 });
  expect(capped.hits).toHaveLength(2);
  expect(capped.exhausted).toBe(true);

  const stopped = await searchAgentMessages(source, "target", { deadline: 0 });
  expect(stopped.exhausted).toBe(false);
});

it("returns nothing for a blank query", async () => {
  const result = await searchAgentMessages(
    rows([{ type: "user_message", text: "anything" }]),
    "   ",
  );
  expect(result).toEqual({ hits: [], exhausted: true });
});

it("joins assistant chunks of one turn into a single hit", async () => {
  const chunks: AgentTimelineRow[] = [
    {
      seq: 1,
      timestamp: "2026-09-12T00:00:00Z",
      turnId: "t1",
      item: { type: "assistant_message", text: "Максимальна " },
    },
    {
      seq: 2,
      timestamp: "2026-09-12T00:00:01Z",
      turnId: "t1",
      item: { type: "assistant_message", text: "бюджетна модель — 32B." },
    },
  ];
  const result = await searchAgentMessages(chunks, "максимальна бюджетна");
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]?.seq).toBe(2);
  expect(result.hits[0]?.snippet).toContain("бюджетна модель");
});

it("reads the transcript once while its head is unchanged", async () => {
  const source = rows([
    { type: "user_message", text: "Яке максимальне обмеження контексту?" },
    { type: "assistant_message", text: "Контекст — 200k токенів." },
  ]);
  let scans = 0;
  const counted = new Proxy(source, {
    get(target, property) {
      if (property === Symbol.iterator) scans += 1;
      return Reflect.get(target, property);
    },
  });

  const first = await searchCachedAgentMessages("agent-1", "e1", counted, "максимальне");
  const second = await searchCachedAgentMessages("agent-1", "e1", counted, "контекст");

  expect(first.hits).toHaveLength(1);
  expect(second.hits).toHaveLength(2);
  expect(scans).toBe(1);
});

it("searches a fresh index without reading the transcript again", async () => {
  const source = rows([{ type: "user_message", text: "Яке максимальне обмеження контексту?" }]);
  let scans = 0;
  const counted = new Proxy(source, {
    get(target, property) {
      if (property === Symbol.iterator) scans += 1;
      return Reflect.get(target, property);
    },
  });

  const built = await searchCachedAgentMessages("agent-3", "e1", counted, "максимальне");
  expect(built.hits).toHaveLength(1);

  const headless = await searchCachedAgentMessages("agent-3", "e1", undefined, "контекст");
  expect(headless.hits).toHaveLength(1);
  expect(headless.exhausted).toBe(true);
  expect(scans).toBe(1);

  const unknown = await searchCachedAgentMessages("agent-404", "e1", undefined, "контекст");
  expect(unknown).toEqual({ hits: [], exhausted: true });
});

it("re-reads the transcript when rows are appended or the epoch resets", async () => {
  const base = rows([{ type: "user_message", text: "перше повідомлення" }]);
  expect((await searchCachedAgentMessages("agent-2", "e1", base, "друге")).hits).toHaveLength(0);

  const appended = [
    ...base,
    {
      seq: 2,
      timestamp: "2026-09-12T00:01:00Z",
      item: { type: "user_message", text: "друге повідомлення" },
    },
  ];
  expect((await searchCachedAgentMessages("agent-2", "e1", appended, "друге")).hits).toHaveLength(
    1,
  );

  expect((await searchCachedAgentMessages("agent-2", "e2", base, "друге")).hits).toHaveLength(0);
});

it("warms an index off the request path so the next search skips the transcript", async () => {
  const source = rows([{ type: "user_message", text: "Яке максимальне обмеження контексту?" }]);
  let scans = 0;
  const counted = new Proxy(source, {
    get(target, property) {
      if (property === Symbol.iterator) scans += 1;
      return Reflect.get(target, property);
    },
  });

  queueMessageSearchIndexWarm({
    agentId: "agent-5",
    build: async () => ({ epoch: "e1", rows: counted }),
  });
  await setImmediate();

  expect(isMessageSearchIndexFresh("agent-5", "e1", 1)).toBe(true);
  expect(scans).toBe(1);

  const hit = await searchCachedAgentMessages("agent-5", "e1", undefined, "контекст");
  expect(hit.hits).toHaveLength(1);
  expect(scans).toBe(1);
});

it("extracts searchable text without projecting the timeline", () => {
  const messages = buildSearchableMessages(
    rows([
      { type: "user_message", text: "питання" },
      { type: "reasoning", text: "думки" },
      { type: "tool_call", toolName: "bash", callId: "c1", args: { command: "каталог" } },
      { type: "assistant_message", text: "відповідь" },
    ]),
  );
  expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
});

it("exact mode keeps the word order the user typed", async () => {
  const source = rows([
    { type: "user_message", text: "до Bq 250 в іншому запиті" },
    { type: "user_message", text: "ліміт 250 Bq" },
  ]);

  const fuzzy = await searchAgentMessages(source, "250 Bq");
  expect(fuzzy.hits).toHaveLength(2);

  const exact = await searchAgentMessages(source, "250 Bq", { mode: "exact" });
  expect(exact.hits).toHaveLength(1);
  expect(exact.hits[0]?.seq).toBe(2);
  expect(exact.hits[0]?.snippet).toContain("250 Bq");
});

it("exact mode ignores case and keeps the newest matches", async () => {
  const result = await searchAgentMessages(
    rows([
      { type: "user_message", text: "Ліміт 250 Bq" },
      { type: "user_message", text: "ліміт 250 BQ" },
      { type: "user_message", text: "інше повідомлення" },
    ]),
    "250 bq",
    { mode: "exact", limit: 1 },
  );

  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]?.seq).toBe(2);
  expect(result.exhausted).toBe(false);
});

it("reuses one index for both match modes", async () => {
  const source = rows([{ type: "user_message", text: "ліміт 250 Bq" }]);

  const exact = await searchCachedAgentMessages("agent-6", "e1", source, "250 Bq", {
    mode: "exact",
  });
  expect(exact.hits).toHaveLength(1);

  const fuzzy = await searchCachedAgentMessages("agent-6", "e1", undefined, "ліміт");
  expect(fuzzy.hits).toHaveLength(1);
});

it("does not match digit-only queries inside larger numbers", async () => {
  const result = await searchAgentMessages(
    rows([
      { type: "user_message", text: "the dose was 250 Bq" },
      { type: "user_message", text: "the dose was 1250 Bq, not 25" },
      { type: "user_message", text: "version 0.16.2-beta.905 was pinned" },
    ]),
    "250",
  );
  expect(result.hits.map((hit) => hit.seq)).toEqual([1]);
});

it("does not match single letters inside words", async () => {
  const result = await searchAgentMessages(
    rows([
      { type: "user_message", text: "яка є тут" },
      { type: "user_message", text: "я вибрав" },
    ]),
    "я",
  );
  expect(result.hits.map((hit) => hit.seq)).toEqual([2]);
});

it("indexes a digit-only token without matching every digit-containing word", async () => {
  const result = await searchAgentMessages(
    [
      {
        seq: 1,
        timestamp: "2026-09-12T00:00:00Z",
        turnId: "t1",
        item: { type: "assistant_message", text: "the cost is 250 dollars" },
      },
      {
        seq: 2,
        timestamp: "2026-09-12T00:00:01Z",
        turnId: "t2",
        item: { type: "assistant_message", text: "the cost is 1250 dollars" },
      },
    ] as never,
    "250",
  );
  expect(result.hits.map((hit) => hit.seq)).toEqual([1]);
});
