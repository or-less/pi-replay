import {
  createAssistantMessageEventStream,
  createProvider,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findReplayScript, listReplayScripts } from "../registry.js";
import { abortableDelay, splitReplayChunks, splitToolCallChunks } from "./timing.js";

export const REPLAY_PROVIDER_ID = "pi-replay";
export const REPLAY_MODEL_ID = "replay";
export const REPLAY_API_ID = "pi-replay-stream";

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function baseMessage(model: Model<string>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: structuredClone(ZERO_USAGE),
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function errorMessage(model: Model<string>, message: string, aborted = false): AssistantMessage {
  return {
    ...baseMessage(model),
    stopReason: aborted ? "aborted" : "error",
    errorMessage: message,
  };
}

async function streamBlock(
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  block: AssistantMessage["content"][number],
  contentIndex: number,
  speed: number,
  signal?: AbortSignal,
): Promise<void> {
  if (block.type === "text") {
    const partialBlock = { type: "text" as const, text: "" };
    output.content.push(partialBlock);
    stream.push({ type: "text_start", contentIndex, partial: output });
    for (const chunk of splitReplayChunks(block.text, speed)) {
      await abortableDelay(chunk.delayMs, signal);
      partialBlock.text += chunk.text;
      stream.push({ type: "text_delta", contentIndex, delta: chunk.text, partial: output });
    }
    stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
    return;
  }

  if (block.type === "thinking") {
    const partialBlock = { type: "thinking" as const, thinking: "" };
    output.content.push(partialBlock);
    stream.push({ type: "thinking_start", contentIndex, partial: output });
    for (const chunk of splitReplayChunks(block.thinking, speed)) {
      await abortableDelay(chunk.delayMs, signal);
      partialBlock.thinking += chunk.text;
      stream.push({ type: "thinking_delta", contentIndex, delta: chunk.text, partial: output });
    }
    stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
    return;
  }

  const partialBlock: ToolCall = {
    type: "toolCall",
    id: block.id,
    name: block.name,
    arguments: {},
  };
  output.content.push(partialBlock);
  stream.push({ type: "toolcall_start", contentIndex, partial: output });
  const json = JSON.stringify(block.arguments);
  for (const chunk of splitToolCallChunks(json, speed)) {
    await abortableDelay(chunk.delayMs, signal);
    stream.push({ type: "toolcall_delta", contentIndex, delta: chunk.text, partial: output });
  }
  partialBlock.arguments = structuredClone(block.arguments);
  stream.push({
    type: "toolcall_end",
    contentIndex,
    toolCall: structuredClone(block),
    partial: output,
  });
}

export function streamReplayResponse(
  model: Model<string>,
  _context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  queueMicrotask(async () => {
    let output = baseMessage(model);
    let activeScript: ReturnType<typeof findReplayScript>;
    try {
      const script = findReplayScript(options?.sessionId);
      activeScript = script;
      if (!script) throw new Error(`No replay script is bound to session ${options?.sessionId ?? "(unknown)"}`);
      const response = script.responses[script.responseCursor++];
      if (!response) throw new Error("Replay response queue is exhausted");
      const speed = script.options.speed;

      stream.push({ type: "start", partial: output });
      for (let index = 0; index < response.content.length; index += 1) {
        await streamBlock(stream, output, response.content[index]!, index, speed, options?.signal);
      }

      output = {
        ...output,
        content: output.content,
        stopReason: response.stopReason,
        errorMessage: response.errorMessage,
        usage: structuredClone(ZERO_USAGE),
      };
      if (output.stopReason === "error" || output.stopReason === "aborted") {
        stream.push({ type: "error", reason: output.stopReason, error: output });
      } else {
        const reason = output.stopReason === "pending" ? "stop" : output.stopReason;
        output.stopReason = reason;
        stream.push({ type: "done", reason, message: output });
      }
      stream.end(output);
    } catch (error) {
      const aborted = options?.signal?.aborted ?? false;
      if (aborted && activeScript) activeScript.status = "cancelled";
      output = errorMessage(model, aborted ? "Request was aborted" : error instanceof Error ? error.message : String(error), aborted);
      stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: output });
      stream.end(output);
    }
  });

  return stream;
}

export function registerReplayProvider(pi: ExtensionAPI): void {
  const replayModels = new Map<string, string>([[REPLAY_MODEL_ID, "Replay"]]);
  for (const script of listReplayScripts()) {
    replayModels.set(script.replayModelId, script.originalModel?.name || script.replayModelId);
  }

  pi.registerProvider(createProvider({
    id: REPLAY_PROVIDER_ID,
    name: "Pi Replay",
    auth: {
      apiKey: {
        name: "Pi Replay",
        async resolve() {
          return { auth: {}, source: "local replay" };
        },
      },
    },
    models: [...replayModels].map(([id, name]) => ({
      id,
      name,
      api: REPLAY_API_ID,
      provider: REPLAY_PROVIDER_ID,
      baseUrl: "http://localhost:0",
      reasoning: true,
      input: ["text", "image"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 1_000_000,
    })),
    api: {
      stream: streamReplayResponse,
      streamSimple: streamReplayResponse,
    },
  }));
}
