import type { ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ReplayOptions, ReplaySnapshot } from "../types.js";
import { groupReplayTurns } from "./parser.js";

export function captureReplaySnapshot(
  ctx: ExtensionCommandContext,
  options: ReplayOptions,
): ReplaySnapshot {
  const manager = ctx.sessionManager;
  const branchEntries = () => manager.getBranch().filter((entry) => entry.type !== "compaction");
  // Full mode already contains the pre-compaction path, so compaction checkpoints
  // are omitted above to avoid replaying their retainedTail messages twice.
  let mode: ReplaySnapshot["source"]["mode"] = options.full ? "full-branch" : "context";
  let entries = structuredClone(options.full ? branchEntries() : manager.buildContextEntries()) as SessionEntry[];
  let turns = groupReplayTurns(entries, options);

  // Some hosts can expose an empty/stale effective-context projection while the
  // persisted branch still contains messages. Falling back keeps /replay useful
  // after compaction and across Pi Web runtime boundaries.
  const hasUserTurn = turns.some((turn) => turn.sourceMessages.some((captured) =>
    typeof captured.message === "object"
    && captured.message !== null
    && (captured.message as { role?: unknown }).role === "user"));
  if (!options.full && !hasUserTurn) {
    mode = "full-branch";
    entries = structuredClone(branchEntries()) as SessionEntry[];
    turns = groupReplayTurns(entries, options);
  }

  return {
    source: {
      sessionId: manager.getSessionId(),
      sessionFile: manager.getSessionFile(),
      cwd: manager.getCwd(),
      capturedAt: Date.now(),
      mode,
      model: ctx.model ? {
        id: ctx.model.id,
        name: ctx.model.name,
        provider: ctx.model.provider,
      } : undefined,
    },
    turns,
  };
}
