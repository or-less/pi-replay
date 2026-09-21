import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerReplayMockTools, registerReplayToolResultRestorer } from "../src/tools/mock-tools.js";
import { bindReplaySession, registerReplayScript, resetReplayRegistryForTests } from "../src/registry.js";
import type { ReplayScript } from "../src/types.js";

function script(): ReplayScript {
  return {
    id: "s",
    originalSessionId: "o",
    originalSessionFile: "/tmp/o",
    createdAt: 1,
    replayModelId: "replay",
    options: { full: false, speed: 4, showTools: true, showThinking: false },
    turns: [],
    responses: [{
      role: "assistant",
      content: [{ type: "toolCall", id: "replay-call", name: "bash", arguments: { command: "touch forbidden" } }],
      api: "pi-replay-stream",
      provider: "pi-replay",
      model: "replay",
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 1,
    }],
    responseCursor: 0,
    turnCursor: 0,
    toolResults: new Map([["replay-call", {
      replayToolCallId: "replay-call",
      originalToolCallId: "old",
      toolName: "bash",
      content: [{ type: "text", text: "saved output" }],
      details: { exitCode: 0 },
      isError: false,
    }]]),
    status: "prepared",
  };
}

test("tool result hook restores historical error state", () => {
  resetReplayRegistryForTests();
  const replay = script();
  const saved = replay.toolResults.get("replay-call")!;
  saved.isError = true;
  registerReplayScript(replay);
  bindReplaySession(replay.id, "temp");
  let handler: ((event: { toolCallId: string }, ctx: unknown) => unknown) | undefined;
  const pi = {
    on: (_event: string, value: typeof handler) => { handler = value; },
  } as unknown as ExtensionAPI;
  registerReplayToolResultRestorer(pi);
  const patch = handler!({ toolCallId: "replay-call" }, {
    sessionManager: { getSessionId: () => "temp", getSessionFile: () => undefined },
  }) as { isError: boolean };
  assert.equal(patch.isError, true);
});

test("mock tool returns saved output without executing historical input", async () => {
  let registered: ToolDefinition | undefined;
  let active = ["read", "bash"];
  const pi = {
    registerTool(tool: ToolDefinition) { registered = tool; },
    getActiveTools: () => active,
    setActiveTools(names: string[]) { active = names; },
  } as unknown as ExtensionAPI;

  registerReplayMockTools(pi, script());
  assert.equal(registered?.name, "bash");
  const result = await registered!.execute("replay-call", { command: "touch forbidden" }, undefined, undefined, {} as never);
  assert.equal(result.content[0]?.type, "text");
  if (result.content[0]?.type === "text") assert.equal(result.content[0].text, "saved output");
  assert.ok(active.includes("bash"));
});
