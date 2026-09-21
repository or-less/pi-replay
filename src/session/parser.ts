import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { CapturedReplayMessage, ReplayItem, ReplayOptions, ReplayTurn } from "../types.js";

interface MessageLike {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

interface ParsedMessage extends CapturedReplayMessage {
  message: MessageLike;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block): string[] => {
      if (typeof block !== "object" || block === null) return [];
      const value = block as { type?: unknown; text?: unknown; mimeType?: unknown; source?: { media_type?: unknown } };
      if (value.type === "text" && typeof value.text === "string") return [value.text];
      if (value.type === "image") {
        const mime = typeof value.mimeType === "string"
          ? value.mimeType
          : typeof value.source?.media_type === "string" ? value.source.media_type : "image";
        return [`[image: ${mime}]`];
      }
      return [];
    })
    .join("\n");
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 100) || "(no text)";
}

function messagesFromEntries(entries: SessionEntry[]): ParsedMessage[] {
  const output: ParsedMessage[] = [];
  for (const entry of entries) {
    try {
      const messages = sessionEntryToContextMessages(entry) as unknown as MessageLike[];
      messages.forEach((message, index) => {
        if (!message || typeof message !== "object" || typeof message.role !== "string") return;
        output.push({
          entryId: entry.id,
          id: `${entry.id}:${index}`,
          message,
        });
      });
    } catch {
      // A malformed or extension-owned entry must not abort the whole replay.
    }
  }
  return output;
}

function normalizeAssistant(message: MessageLike): AssistantMessage {
  const content = Array.isArray(message.content)
    ? message.content.filter((block) => typeof block === "object" && block !== null && typeof (block as { type?: unknown }).type === "string")
    : [];
  return { ...message, content } as unknown as AssistantMessage;
}

function assistantWithoutTools(message: AssistantMessage, showThinking: boolean): AssistantMessage {
  return {
    ...message,
    content: message.content.filter((block) =>
      block.type !== "toolCall" && (showThinking || block.type !== "thinking")),
  };
}

function messageToItems(parsed: ParsedMessage, options: ReplayOptions): ReplayItem[] {
  const { message, entryId, id } = parsed;
  switch (message.role) {
    case "user":
      return [{ kind: "user", id, entryId, message: message as unknown as UserMessage }];
    case "assistant": {
      const assistant = normalizeAssistant(message);
      const items: ReplayItem[] = [];
      const visible = assistantWithoutTools(assistant, options.showThinking);
      if (visible.content.length > 0 || assistant.stopReason === "error" || assistant.stopReason === "aborted") {
        items.push({ kind: "assistant", id, entryId, message: visible });
      }
      if (options.showTools) {
        assistant.content.forEach((block, blockIndex) => {
          if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
            items.push({
              kind: "tool",
              id: `${id}:tool:${blockIndex}`,
              entryId,
              call: block as ToolCall,
            });
          }
        });
      }
      return items;
    }
    case "bashExecution":
      return [{
        kind: "bash",
        id,
        entryId,
        command: String(message.command ?? ""),
        output: String(message.output ?? ""),
        exitCode: typeof message.exitCode === "number" ? message.exitCode : undefined,
        cancelled: Boolean(message.cancelled),
      }];
    case "compactionSummary":
      return [{
        kind: "summary",
        id,
        entryId,
        summaryKind: "compaction",
        text: String(message.summary ?? ""),
      }];
    case "branchSummary":
      return [{
        kind: "summary",
        id,
        entryId,
        summaryKind: "branch",
        text: String(message.summary ?? ""),
      }];
    case "custom":
      if (message.display === false) return [];
      return [{
        kind: "custom",
        id,
        entryId,
        customType: String(message.customType ?? "custom"),
        content: textFromContent(message.content),
      }];
    case "toolResult": {
      if (!options.showTools) return [];
      const result = message as unknown as ToolResultMessage;
      if (typeof result.toolCallId !== "string") return [];
      return [{ kind: "tool-result", id, entryId, result }];
    }
    default:
      return [];
  }
}

function pairToolResults(items: ReplayItem[]): void {
  const pending = new Map<string, Extract<ReplayItem, { kind: "tool" }>[]>();
  for (const item of items) {
    if (item.kind === "tool") {
      const queue = pending.get(item.call.id) ?? [];
      queue.push(item);
      pending.set(item.call.id, queue);
    } else if (item.kind === "tool-result") {
      const queue = pending.get(item.result.toolCallId);
      const callItem = queue?.shift();
      if (callItem) item.call = callItem.call;
      if (queue?.length === 0) pending.delete(item.result.toolCallId);
    }
  }
}

export function groupReplayTurns(entries: SessionEntry[], options: ReplayOptions): ReplayTurn[] {
  const parsedMessages = messagesFromEntries(entries);
  const turns: ReplayTurn[] = [];
  let current: ReplayTurn | undefined;

  for (const parsed of parsedMessages) {
    const items = messageToItems(parsed, options);
    const userItem = items.find((item) => item.kind === "user");
    if (userItem || !current) {
      current = {
        id: userItem ? `turn:${parsed.entryId}` : `turn:synthetic:${turns.length}`,
        index: turns.length,
        entryIds: [],
        items: [],
        sourceMessages: [],
        selected: true,
        preview: userItem?.kind === "user"
          ? previewText(textFromContent(userItem.message.content))
          : "Session context",
      };
      turns.push(current);
    }
    current.sourceMessages.push(parsed);
    current.items.push(...items);
    if (!current.entryIds.includes(parsed.entryId)) current.entryIds.push(parsed.entryId);
  }

  pairToolResults(turns.flatMap((turn) => turn.items));

  if (options.last !== undefined && turns.length > options.last) {
    return turns.slice(-options.last).map((turn, index) => ({ ...turn, index }));
  }
  return turns;
}

export function getMessageText(content: unknown): string {
  return textFromContent(content);
}
