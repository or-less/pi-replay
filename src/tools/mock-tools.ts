import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { findReplayScript } from "../registry.js";
import { replayToolNames } from "../session/compile-script.js";
import type { ReplayScript } from "../types.js";

export function registerReplayMockTools(pi: ExtensionAPI, script: ReplayScript): void {
  for (const toolName of replayToolNames(script)) {
    pi.registerTool({
      name: toolName,
      label: toolName,
      description: `Replay-only mock for historical ${toolName} calls. Never executes the real tool.`,
      parameters: Type.Object({}, { additionalProperties: true }),
      async execute(toolCallId) {
        const result = script.toolResults.get(toolCallId);
        if (!result) throw new Error(`No saved replay result for ${toolName} call ${toolCallId}`);
        return {
          content: structuredClone(result.content),
          details: structuredClone(result.details),
        };
      },
    });
  }

  pi.setActiveTools([...new Set([...pi.getActiveTools(), ...replayToolNames(script)])]);
}

export function registerReplayToolResultRestorer(pi: ExtensionAPI): void {
  pi.on("tool_result", (event, ctx) => {
    const script = findReplayScript(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
    const saved = script?.toolResults.get(event.toolCallId);
    if (!saved) return;
    return {
      content: structuredClone(saved.content),
      details: structuredClone(saved.details),
      isError: saved.isError,
    };
  });
}

export async function activateReplayTools(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  script: ReplayScript,
): Promise<void> {
  registerReplayMockTools(pi, script);
  const model = ctx.modelRegistry.find("pi-replay", script.replayModelId);
  if (!model) throw new Error(`Pi Replay model is not registered: ${script.replayModelId}`);
  const selected = await pi.setModel(model);
  if (!selected) throw new Error("Pi Replay model could not be selected");
}
