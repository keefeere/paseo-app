import { expect, test } from "vitest";
import { createDaemonTestContext } from "../test-utils/index.js";
import { MockLoadTestAgentClient } from "../agent/providers/mock-load-test-agent.js";

/**
 * Cross-chat message search over the wire: a declined word form must find the chat that
 * used another inflection, which the phrase-regex chat find cannot do.
 */
test("searches message text across agents and returns a jumpable position", async () => {
  const ctx = await createDaemonTestContext({
    agentClients: { mock: new MockLoadTestAgentClient() },
    mcpEnabled: false,
    isDev: true,
  });
  try {
    const workspace = await ctx.client.createWorkspace({
      source: { kind: "directory", path: ctx.daemon.staticDir },
    });
    if (!workspace.workspace) throw new Error(workspace.error ?? "Missing workspace");

    const agent = await ctx.client.createAgent({
      workspaceId: workspace.workspace.id,
      provider: "mock",
      cwd: ctx.daemon.staticDir,
      title: "Бюджетні моделі",
      initialPrompt: "А яка максимально бюджетна модель для локального запуску?",
    });
    await ctx.client.waitForFinish(agent.id, 60_000);

    expect(ctx.client.getLastServerInfoMessage()?.features?.messageSearch).toBe(true);

    const result = await ctx.client.searchAgentMessages({ query: "який максимально" });
    expect(result.error).toBeNull();
    const hit = result.hits.find((entry) => entry.agentId === agent.id);
    expect(hit).toBeDefined();
    expect(hit?.seq).toBeGreaterThan(0);
    expect(hit?.epoch).toBeTruthy();
    expect(hit?.snippet).toContain("максимально");
    expect(hit?.ranges.length).toBeGreaterThan(0);

    // A query nothing in the transcript declines into still answers empty.
    const miss = await ctx.client.searchAgentMessages({ query: "квантовий компʼютер" });
    expect(miss.hits).toEqual([]);
    expect(miss.partial).toBe(false);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);
