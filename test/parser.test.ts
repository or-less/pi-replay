import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_REPLAY_OPTIONS } from "../src/args.js";
import { getMessageText, groupReplayTurns } from "../src/session/parser.js";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function entry(id: string, parentId: string | null, message: unknown): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message,
  } as unknown as SessionEntry;
}

test("uses a visible placeholder for image content", () => {
  assert.equal(getMessageText([{ type: "image", data: "abc", mimeType: "image/png" }]), "[image: image/png]");
});

test("groups messages into turns and pairs tool results", () => {
  const entries = [
    entry("u1", null, { role: "user", content: "First question", timestamp: 1 }),
    entry("a1", "u1", {
      role: "assistant",
      content: [
        { type: "text", text: "Checking" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
      ],
      api: "test",
      provider: "test",
      model: "test",
      usage,
      stopReason: "toolUse",
      timestamp: 2,
    }),
    entry("t1", "a1", {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
      isError: false,
      timestamp: 3,
    }),
    entry("u2", "t1", { role: "user", content: "Second question", timestamp: 4 }),
  ];

  const turns = groupReplayTurns(entries, DEFAULT_REPLAY_OPTIONS);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.preview, "First question");
  const result = turns[0]?.items.find((item) => item.kind === "tool-result");
  assert.equal(result?.kind, "tool-result");
  if (result?.kind === "tool-result") {
    assert.equal(result.result.toolCallId, "call-1");
    assert.equal(result.call?.name, "read");
  }
});

test("pairs duplicate tool ids in message order and preserves orphan results", () => {
  const call = (id: string, parentId: string | null) => entry(id, parentId, {
    role: "assistant",
    content: [{ type: "toolCall", id: "same", name: "read", arguments: { path: id } }],
    api: "test",
    provider: "test",
    model: "test",
    usage,
    stopReason: "toolUse",
    timestamp: 1,
  });
  const result = (id: string, parentId: string | null, text: string) => entry(id, parentId, {
    role: "toolResult",
    toolCallId: "same",
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
  });
  const turns = groupReplayTurns([
    entry("u", null, { role: "user", content: "go", timestamp: 1 }),
    call("a1", "u"), result("r1", "a1", "one"),
    call("a2", "r1"), result("r2", "a2", "two"),
    result("orphan", "r2", "orphan"),
  ], DEFAULT_REPLAY_OPTIONS);
  const results = turns[0]!.items.filter((item) => item.kind === "tool-result");
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((item) => item.kind === "tool-result" ? item.call?.arguments.path : undefined), ["a1", "a2", undefined]);
});

test("ignores malformed assistant content instead of throwing", () => {
  const entries = [
    entry("u", null, { role: "user", content: "safe", timestamp: 1 }),
    entry("bad", "u", { role: "assistant", content: null, timestamp: 2 }),
  ];
  assert.doesNotThrow(() => groupReplayTurns(entries, DEFAULT_REPLAY_OPTIONS));
});

test("last limits turns and no-tools removes tools", () => {
  const entries = [
    entry("u1", null, { role: "user", content: "One", timestamp: 1 }),
    entry("u2", "u1", { role: "user", content: "Two", timestamp: 2 }),
  ];
  const turns = groupReplayTurns(entries, { ...DEFAULT_REPLAY_OPTIONS, last: 1, showTools: false });
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.preview, "Two");
  assert.equal(turns[0]?.index, 0);
});
