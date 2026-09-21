import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_REPLAY_OPTIONS } from "../src/args.js";
import { captureReplaySnapshot } from "../src/session/snapshot.js";

function messageEntry(id: string, message: unknown): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message,
  } as unknown as SessionEntry;
}

test("falls back to the persisted branch when effective context has no user turn", () => {
  const branch = [messageEntry("u", { role: "user", content: "hello", timestamp: 1 })];
  const ctx = {
    sessionManager: {
      buildContextEntries: () => [],
      getBranch: () => branch,
      getSessionId: () => "session",
      getSessionFile: () => "/tmp/session.jsonl",
      getCwd: () => "/tmp",
    },
  } as unknown as ExtensionCommandContext;

  const snapshot = captureReplaySnapshot(ctx, { ...DEFAULT_REPLAY_OPTIONS, full: false });
  assert.equal(snapshot.source.mode, "full-branch");
  assert.equal(snapshot.turns.length, 1);
  assert.equal(snapshot.turns[0]?.preview, "hello");
});
