import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseReplayArgs } from "./args.js";
import { compileReplayScript } from "./session/compile-script.js";
import { captureReplaySnapshot } from "./session/snapshot.js";
import { bindReplaySession, findReplayScript, registerReplayScript, removeReplayScript } from "./registry.js";
import { restoreOriginalSession } from "./session/temporary-session.js";
import { ReplaySelectionView, type SelectionResult } from "./ui/selection-view.js";

const REPLAY_MARKER = "pi-replay-session";

interface ActiveSelection {
  close: () => void;
}

function replayWasCancelled(script: { status: string }): boolean {
  return script.status === "cancelled";
}

export function registerReplayCommand(pi: ExtensionAPI): void {
  const state: { selection?: ActiveSelection } = {};

  pi.on("session_shutdown", () => {
    state.selection?.close();
    state.selection = undefined;
  });

  pi.registerCommand("replay", {
    description: "Replay the current session through Pi's native conversation UI",
    handler: async (args, ctx) => {
      if (state.selection) {
        ctx.ui.notify("A replay selection is already open", "warning");
        return;
      }
      await startReplay(args, ctx, state);
    },
  });

  pi.registerCommand("replay-exit", {
    description: "Exit a replay session and restore its original session",
    handler: async (_args, ctx) => {
      const script = findReplayScript(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
      if (!script) {
        ctx.ui.notify("This is not an active replay session", "warning");
        return;
      }
      await restoreOriginalSession(ctx, script);
    },
  });
}

async function startReplay(
  args: string,
  ctx: ExtensionCommandContext,
  state: { selection?: ActiveSelection },
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/replay requires an interactive UI", "error");
    return;
  }
  if (!ctx.isIdle()) {
    ctx.ui.notify("Wait for the current agent run to finish before replaying", "warning");
    return;
  }
  if (!ctx.sessionManager.getSessionFile()) {
    ctx.ui.notify("Native replay requires a persisted session", "error");
    return;
  }

  let scriptId: string | undefined;
  try {
    const options = parseReplayArgs(args);
    const snapshot = captureReplaySnapshot(ctx, options);
    if (snapshot.turns.length === 0) {
      ctx.ui.notify("The current session has no replayable conversation", "warning");
      return;
    }

    const selectionHandle: ActiveSelection = { close: () => {} };
    state.selection = selectionHandle;
    const selection = await ctx.ui.custom<SelectionResult | undefined>((tui, theme, _keybindings, done) => {
      let closed = false;
      selectionHandle.close = () => {
        if (closed) return;
        closed = true;
        done(undefined);
      };
      return new ReplaySelectionView(snapshot.turns, theme, (result) => {
        if (closed) return;
        closed = true;
        done(result);
      }, () => tui.requestRender());
    });
    if (state.selection === selectionHandle) state.selection = undefined;
    if (!selection) return;

    const script = compileReplayScript({ ...snapshot, turns: selection.turns }, options);
    scriptId = script.id;
    registerReplayScript(script);

    if (ctx.mode === "rpc") {
      ctx.ui.setWidget("pi-replay-handoff", [
        "Pi Replay 已准备好。",
        "1. 点击左侧 + 新建一个空白 session",
        "2. 在新 session 中执行 /replay-start",
        "回放完成后，从左侧会话列表返回当前 session。",
      ], { placement: "aboveEditor" });
      ctx.ui.notify("Replay prepared. Create a new session, then run /replay-start.", "info");
      return;
    }

    const sourceName = ctx.sessionManager.getSessionName();
    const result = await ctx.newSession({
      parentSession: script.originalSessionFile,
      setup: async (manager) => {
        bindReplaySession(script.id, manager.getSessionId(), manager.getSessionFile());
        manager.appendCustomEntry(REPLAY_MARKER, {
          version: 1,
          scriptId: script.id,
          originalSessionId: script.originalSessionId,
          originalSessionFile: script.originalSessionFile,
        });
        manager.appendSessionInfo(`Replay · ${sourceName ?? new Date(script.createdAt).toLocaleString()}`);
      },
      withSession: async (replayCtx) => {
        try {
          await replayCtx.sendUserMessage(`/replay-activate ${script.id}`, { expandPromptTemplates: true });
          script.status = "running";
          for (let index = 0; index < script.turns.length; index += 1) {
            const turn = script.turns[index]!;
            await replayCtx.sendUserMessage(structuredClone(turn.user.content));
            if (replayWasCancelled(script)) throw new Error("Replay was interrupted");
            if (index < script.turns.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, Math.max(1, 650 / script.options.speed)));
            }
          }
          script.status = "finished";
          const shouldReturn = await replayCtx.ui.confirm(
            "Replay complete",
            "Return to the original session? Choose No to keep this replay open; use /replay-exit later.",
          );
          if (shouldReturn) await restoreOriginalSession(replayCtx, script);
          else replayCtx.ui.notify("Replay session kept open. Use /replay-exit to return.", "info");
        } catch (error) {
          script.status = "cancelled";
          replayCtx.ui.notify(`Replay stopped: ${error instanceof Error ? error.message : String(error)}`, "error");
          await restoreOriginalSession(replayCtx, script);
        }
      },
    });

    if (result.cancelled) {
      removeReplayScript(script.id);
      ctx.ui.notify("Replay session creation was cancelled", "warning");
    }
  } catch (error) {
    if (scriptId) removeReplayScript(scriptId);
    state.selection = undefined;
    ctx.ui.notify(`Replay failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
