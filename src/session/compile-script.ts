import { randomUUID } from "node:crypto";
import type { AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type {
  NativeReplayTurn,
  ReplayOptions,
  ReplayScript,
  ReplaySnapshot,
} from "../types.js";

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface RoleMessage {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

function isUserMessage(message: unknown): message is UserMessage {
  return typeof message === "object" && message !== null && (message as RoleMessage).role === "user";
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
  return typeof message === "object" && message !== null &&
    (message as RoleMessage).role === "assistant" && Array.isArray((message as RoleMessage).content);
}

function isToolResultMessage(message: unknown): message is ToolResultMessage {
  return typeof message === "object" && message !== null &&
    (message as RoleMessage).role === "toolResult" &&
    typeof (message as { toolCallId?: unknown }).toolCallId === "string";
}

function compileAssistant(
  message: AssistantMessage,
  scriptId: string,
  turnIndex: number,
  responseIndex: number,
  replayModelId: string,
  options: ReplayOptions,
  pendingCalls: Map<string, string[]>,
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  message.content.forEach((block, blockIndex) => {
    if (block.type === "thinking") {
      if (options.showThinking) content.push(structuredClone(block));
      return;
    }
    if (block.type === "toolCall") {
      if (!options.showTools) return;
      const replayId = `replay:${scriptId}:${turnIndex}:${responseIndex}:${blockIndex}`;
      const queue = pendingCalls.get(block.id) ?? [];
      queue.push(replayId);
      pendingCalls.set(block.id, queue);
      content.push({ ...structuredClone(block), id: replayId });
      return;
    }
    content.push(structuredClone(block));
  });

  const hasTools = content.some((block) => block.type === "toolCall");
  return {
    ...structuredClone(message),
    content,
    provider: "pi-replay",
    model: replayModelId,
    api: "pi-replay-stream",
    usage: structuredClone(ZERO_USAGE),
    stopReason: hasTools ? "toolUse" : message.stopReason === "error" || message.stopReason === "aborted"
      ? message.stopReason
      : "stop",
    timestamp: Date.now(),
  };
}

function combineWithoutTools(responses: AssistantMessage[]): AssistantMessage[] {
  if (responses.length <= 1) return responses;
  const last = responses.at(-1)!;
  return [{
    ...last,
    content: responses.flatMap((response) => response.content),
    stopReason: last.stopReason === "error" || last.stopReason === "aborted" ? last.stopReason : "stop",
    usage: structuredClone(ZERO_USAGE),
  }];
}

export function compileReplayScript(snapshot: ReplaySnapshot, options: ReplayOptions): ReplayScript {
  if (!snapshot.source.sessionFile) throw new Error("Native replay requires a persisted source session");

  const scriptId = randomUUID();
  const replayModelId = snapshot.source.model?.id || "replay";
  const turns: NativeReplayTurn[] = [];
  const responses: AssistantMessage[] = [];
  const toolResults = new Map<string, ReplayScript["toolResults"] extends Map<string, infer T> ? T : never>();
  const pendingCalls = new Map<string, string[]>();

  for (const selectedTurn of snapshot.turns.filter((turn) => turn.selected)) {
    const userSource = selectedTurn.sourceMessages.find(({ message }) => isUserMessage(message));
    if (!userSource || !isUserMessage(userSource.message)) continue;

    const turnIndex = turns.length;
    let responseIndex = 0;
    let turnResponses: AssistantMessage[] = [];

    for (const captured of selectedTurn.sourceMessages) {
      if (isAssistantMessage(captured.message)) {
        const response = compileAssistant(
          captured.message,
          scriptId,
          turnIndex,
          responseIndex++,
          replayModelId,
          options,
          pendingCalls,
        );
        if (response.content.length > 0 || response.stopReason === "error" || response.stopReason === "aborted") {
          turnResponses.push(response);
        }
      } else if (isToolResultMessage(captured.message) && options.showTools) {
        const queue = pendingCalls.get(captured.message.toolCallId);
        const replayToolCallId = queue?.shift();
        if (!replayToolCallId) continue;
        if (queue?.length === 0) pendingCalls.delete(captured.message.toolCallId);
        toolResults.set(replayToolCallId, {
          replayToolCallId,
          originalToolCallId: captured.message.toolCallId,
          toolName: captured.message.toolName,
          content: structuredClone(captured.message.content),
          details: structuredClone(captured.message.details),
          isError: captured.message.isError,
        });
      }
    }

    if (!options.showTools) turnResponses = combineWithoutTools(turnResponses);
    if (turnResponses.length === 0) continue;

    const turn: NativeReplayTurn = {
      id: selectedTurn.id,
      sourceEntryIds: [...selectedTurn.entryIds],
      user: structuredClone(userSource.message),
      responses: turnResponses,
    };
    turns.push(turn);
    responses.push(...turnResponses);
  }

  if (turns.length === 0) throw new Error("No replayable user/assistant turns were selected");

  return {
    id: scriptId,
    originalSessionId: snapshot.source.sessionId,
    originalSessionFile: snapshot.source.sessionFile,
    createdAt: Date.now(),
    originalModel: snapshot.source.model ? { ...snapshot.source.model } : undefined,
    replayModelId,
    options: { ...options },
    turns,
    responses,
    responseCursor: 0,
    turnCursor: 0,
    toolResults,
    status: "prepared",
  };
}

export function replayToolNames(script: ReplayScript): string[] {
  const names = new Set<string>();
  for (const response of script.responses) {
    for (const block of response.content) {
      if (block.type === "toolCall") names.add(block.name);
    }
  }
  return [...names];
}
