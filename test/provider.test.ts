import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { streamReplayResponse } from "../src/provider/replay-provider.js";
import {
  bindReplaySession,
  registerReplayScript,
  resetReplayRegistryForTests,
} from "../src/registry.js";
import type { ReplayScript } from "../src/types.js";

const model = {
  id: "replay",
  name: "Replay",
  api: "pi-replay-stream",
  provider: "pi-replay",
  baseUrl: "http://localhost:0",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 1_000_000,
} as Model<string>;

function message(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "pi-replay-stream",
    provider: "pi-replay",
    model: "replay",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
    timestamp: 1,
  };
}

function bind(response: AssistantMessage, speed = 4): ReplayScript {
  resetReplayRegistryForTests();
  const script: ReplayScript = {
    id: "script",
    originalSessionId: "original",
    originalSessionFile: "/tmp/original",
    createdAt: 1,
    replayModelId: "replay",
    options: { full: false, speed: speed as 4, showTools: true, showThinking: true },
    turns: [],
    responses: [response],
    responseCursor: 0,
    turnCursor: 0,
    toolResults: new Map(),
    status: "running",
  };
  registerReplayScript(script);
  bindReplaySession(script.id, "temp");
  return script;
}

test("provider emits one text delta per grapheme", async () => {
  bind(message([{ type: "text", text: "你👨‍👩‍👧‍👦好" }]));
  const events = [];
  for await (const event of streamReplayResponse(model, { messages: [] }, { sessionId: "temp" })) events.push(event);
  const deltas = events.filter((event) => event.type === "text_delta");
  assert.deepEqual(deltas.map((event) => event.type === "text_delta" ? event.delta : ""), ["你", "👨‍👩‍👧‍👦", "好"]);
  assert.equal(events[0]?.type, "start");
  assert.equal(events.at(-1)?.type, "done");
});

test("provider groups graphemes into visible chunks at high speed", async () => {
  const text = "abcdefghijklmnop";
  bind(message([{ type: "text", text }]), 16);
  const deltas: string[] = [];
  for await (const event of streamReplayResponse(model, { messages: [] }, { sessionId: "temp" })) {
    if (event.type === "text_delta") deltas.push(event.delta);
  }
  assert.equal(deltas.join(""), text);
  assert.deepEqual(deltas, ["abcd", "efgh", "ijkl", "mnop"]);
});

test("provider batches all tool-call arguments at high speed", async () => {
  const args = { path: "abcdefghijklmnop.ts", encoding: "utf8" };
  bind(message([{ type: "toolCall", id: "call", name: "read", arguments: args }]), 16);
  const deltas: string[] = [];
  for await (const event of streamReplayResponse(model, { messages: [] }, { sessionId: "temp" })) {
    if (event.type === "toolcall_delta") deltas.push(event.delta);
  }
  const json = JSON.stringify(args);
  assert.equal(deltas.join(""), json);
  assert.ok(deltas.length < json.length);
  assert.ok(deltas.every((delta) => delta.length > 1));
});

test("provider preserves block order including tool calls", async () => {
  bind(message([
    { type: "text", text: "A" },
    { type: "toolCall", id: "call", name: "read", arguments: { path: "a" } },
    { type: "text", text: "B" },
  ]));
  const types: string[] = [];
  for await (const event of streamReplayResponse(model, { messages: [] }, { sessionId: "temp" })) types.push(event.type);
  assert.ok(types.indexOf("text_end") < types.indexOf("toolcall_start"));
  assert.ok(types.indexOf("toolcall_end") < types.lastIndexOf("text_start"));
  assert.equal(types.at(-1), "done");
});

test("provider honors abort signals", async () => {
  const script = bind(message([{ type: "text", text: "abcdef" }]), 0.5);
  const controller = new AbortController();
  const events: string[] = [];
  const stream = streamReplayResponse(model, { messages: [] }, { sessionId: "temp", signal: controller.signal });
  for await (const event of stream) {
    events.push(event.type);
    if (event.type === "text_delta") controller.abort();
  }
  assert.equal(events.at(-1), "error");
  assert.equal(script.status, "cancelled");
});
