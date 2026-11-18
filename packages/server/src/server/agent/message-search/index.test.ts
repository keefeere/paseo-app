import { expect, it } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { matchMessageText, searchAgentMessages } from "./index.js";

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
