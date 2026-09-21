import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { DEFAULT_REPLAY_OPTIONS } from "../src/args.js";
import { compileReplayScript } from "../src/session/compile-script.js";
import type { ReplaySnapshot } from "../src/types.js";

const usage: AssistantMessage["usage"] = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
};
const user: UserMessage = { role: "user", content: "run", timestamp: 1 };
const assistant: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "text", text: "before" },
    { type: "toolCall", id: "same", name: "read", arguments: { path: "a.ts" } },
    { type: "text", text: "after" },
  ],
  api: "x",
  provider: "x",
  model: "x",
  usage,
  stopReason: "toolUse",
  timestamp: 2,
};
const result: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "same",
  toolName: "read",
  content: [{ type: "text", text: "saved" }],
  details: { path: "a.ts" },
  isError: false,
  timestamp: 3,
};
const final: AssistantMessage = {
  ...assistant,
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
  timestamp: 4,
};

function snapshot(): ReplaySnapshot {
  return {
    source: {
      sessionId: "original",
      sessionFile: "/tmp/original.jsonl",
      cwd: "/tmp",
      capturedAt: 1,
      mode: "full-branch",
      model: { id: "gpt-source", name: "GPT Source", provider: "source-provider" },
    },
    turns: [{
      id: "turn:1",
      index: 0,
      entryIds: ["u", "a", "r", "f"],
      items: [],
      sourceMessages: [
        { id: "u:0", entryId: "u", message: user },
        { id: "a:0", entryId: "a", message: assistant },
        { id: "r:0", entryId: "r", message: result },
        { id: "f:0", entryId: "f", message: final },
      ],
      selected: true,
      preview: "run",
    }],
  };
}

test("compiles native responses and rewrites tool ids", () => {
  const script = compileReplayScript(snapshot(), DEFAULT_REPLAY_OPTIONS);
  assert.equal(script.turns.length, 1);
  assert.equal(script.responses.length, 2);
  const blocks = script.responses[0]!.content;
  assert.deepEqual(blocks.map((block) => block.type), ["text", "toolCall", "text"]);
  const call = blocks[1];
  assert.equal(call?.type, "toolCall");
  if (call?.type === "toolCall") {
    assert.notEqual(call.id, "same");
    assert.equal(script.toolResults.get(call.id)?.content[0]?.type, "text");
  }
  assert.equal(script.responses[0]?.usage.cost.total, 0);
  assert.equal(script.replayModelId, "gpt-source");
  assert.equal(script.responses[0]?.model, "gpt-source");
  assert.equal(script.responses[0]?.provider, "pi-replay");
});

test("no-tools combines continuations into one terminal response", () => {
  const script = compileReplayScript(snapshot(), { ...DEFAULT_REPLAY_OPTIONS, showTools: false });
  assert.equal(script.responses.length, 1);
  assert.deepEqual(script.responses[0]?.content.map((block) => block.type), ["text", "text", "text"]);
  assert.equal(script.responses[0]?.stopReason, "stop");
  assert.equal(script.toolResults.size, 0);
});
