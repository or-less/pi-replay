import { readFile, unlink } from "node:fs/promises";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { removeReplayScript } from "../registry.js";
import type { ReplayScript } from "../types.js";

export async function deleteVerifiedTemporarySession(
  sessionFile: string | undefined,
  expectedSessionId: string | undefined,
): Promise<boolean> {
  if (!sessionFile || !expectedSessionId) return false;
  const firstLine = (await readFile(sessionFile, "utf8")).split("\n", 1)[0];
  if (!firstLine) return false;
  const header = JSON.parse(firstLine) as { type?: unknown; id?: unknown };
  if (header.type !== "session" || header.id !== expectedSessionId) {
    throw new Error("Refusing to delete replay session: session header mismatch");
  }
  await unlink(sessionFile);
  return true;
}

export async function restoreOriginalSession(
  ctx: ExtensionCommandContext,
  script: ReplayScript,
): Promise<boolean> {
  const temporaryFile = script.temporarySessionFile ?? ctx.sessionManager.getSessionFile();
  const temporaryId = script.temporarySessionId ?? ctx.sessionManager.getSessionId();
  script.status = "restoring";

  const result = await ctx.switchSession(script.originalSessionFile, {
    withSession: async (restoredCtx) => {
      try {
        await deleteVerifiedTemporarySession(temporaryFile, temporaryId);
      } catch (error) {
        restoredCtx.ui.notify(
          `Restored the original session, but could not delete replay session: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      } finally {
        removeReplayScript(script.id);
      }
    },
  });
  return !result.cancelled;
}
