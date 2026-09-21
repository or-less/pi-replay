import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  bindReplaySession,
  findLatestPreparedReplayScript,
  findReplayScript,
  getReplayScriptById,
  removeReplayScript,
} from "../registry.js";
import { activateReplayTools } from "../tools/mock-tools.js";
import { deleteVerifiedTemporarySession } from "./temporary-session.js";
import type { ReplayScript } from "../types.js";

async function cleanUpWebReplay(ctx: ExtensionCommandContext, script: ReplayScript): Promise<void> {
  try {
    await deleteVerifiedTemporarySession(
      script.temporarySessionFile ?? ctx.sessionManager.getSessionFile(),
      script.temporarySessionId ?? ctx.sessionManager.getSessionId(),
    );
  } catch (error) {
    ctx.ui.notify(`Could not delete replay session: ${error instanceof Error ? error.message : String(error)}`, "warning");
  } finally {
    removeReplayScript(script.id);
  }
}

export function registerReplayActivationCommand(pi: ExtensionAPI): void {
  pi.registerCommand("replay-activate", {
    description: "Internal command used to initialize a temporary replay session",
    handler: async (args, ctx) => {
      const scriptId = args.trim();
      const script = getReplayScriptById(scriptId);
      if (!script) throw new Error(`Unknown replay script: ${scriptId}`);

      const sessionId = ctx.sessionManager.getSessionId();
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (script.temporarySessionId && script.temporarySessionId !== sessionId) {
        throw new Error("Replay script is bound to a different temporary session");
      }
      bindReplaySession(script.id, sessionId, sessionFile);
      await activateReplayTools(pi, ctx, script);
    },
  });

  pi.registerCommand("replay-start", {
    description: "Start the replay prepared in another Pi Web session",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "rpc") {
        ctx.ui.notify("/replay-start is only needed in Pi Web; use /replay in the TUI.", "warning");
        return;
      }
      const script = findLatestPreparedReplayScript();
      if (!script) {
        ctx.ui.notify("No prepared replay was found. Return to the source session and run /replay first.", "warning");
        return;
      }
      if (ctx.sessionManager.getSessionId() === script.originalSessionId) {
        ctx.ui.notify("Create a new blank session before running /replay-start.", "warning");
        return;
      }
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("Replay requires a persisted destination session.", "error");
        return;
      }

      bindReplaySession(script.id, ctx.sessionManager.getSessionId(), sessionFile);
      await activateReplayTools(pi, ctx, script);
      script.status = "running";
      script.turnCursor = 1;
      const firstTurn = script.turns[0];
      if (!firstTurn) {
        script.status = "cancelled";
        await cleanUpWebReplay(ctx, script);
        ctx.ui.notify("The prepared replay contains no user turns.", "error");
        return;
      }
      pi.sendUserMessage(structuredClone(firstTurn.user.content));
    },
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const script = findReplayScript(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
    if (!script || (script.status !== "running" && script.status !== "cancelled")) return;

    if (script.status === "cancelled") {
      await cleanUpWebReplay(ctx as ExtensionCommandContext, script);
      ctx.ui.notify("Replay interrupted. Return to the original session from the session list.", "warning");
      return;
    }

    const nextTurn = script.turns[script.turnCursor];
    if (nextTurn) {
      script.turnCursor += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, 650 / script.options.speed)));
      pi.sendUserMessage(structuredClone(nextTurn.user.content));
      return;
    }

    script.status = "finished";
    await cleanUpWebReplay(ctx as ExtensionCommandContext, script);
    ctx.ui.notify("Replay complete. Return to the original session from the session list.", "info");
  });
}
