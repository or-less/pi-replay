import type { AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

export type ReplaySpeed = number;

export interface ReplayOptions {
  full: boolean;
  last?: number;
  speed: ReplaySpeed;
  showTools: boolean;
  showThinking: boolean;
}

export interface ReplaySource {
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  capturedAt: number;
  mode: "context" | "full-branch";
  model?: {
    id: string;
    name: string;
    provider: string;
  };
}

export interface ReplayUserItem {
  kind: "user";
  id: string;
  entryId: string;
  message: UserMessage;
}

export interface ReplayAssistantItem {
  kind: "assistant";
  id: string;
  entryId: string;
  message: AssistantMessage;
}

export interface ReplayToolItem {
  kind: "tool";
  id: string;
  entryId: string;
  call: ToolCall;
}

export interface ReplayToolResultItem {
  kind: "tool-result";
  id: string;
  entryId: string;
  result: ToolResultMessage;
  call?: ToolCall;
}

export interface ReplayBashItem {
  kind: "bash";
  id: string;
  entryId: string;
  command: string;
  output: string;
  exitCode?: number;
  cancelled: boolean;
}

export interface ReplaySummaryItem {
  kind: "summary";
  id: string;
  entryId: string;
  summaryKind: "compaction" | "branch";
  text: string;
}

export interface ReplayCustomItem {
  kind: "custom";
  id: string;
  entryId: string;
  customType: string;
  content: string;
}

export type ReplayItem =
  | ReplayUserItem
  | ReplayAssistantItem
  | ReplayToolItem
  | ReplayToolResultItem
  | ReplayBashItem
  | ReplaySummaryItem
  | ReplayCustomItem;

export interface CapturedReplayMessage {
  entryId: string;
  id: string;
  message: unknown;
}

export interface ReplayTurn {
  id: string;
  index: number;
  entryIds: string[];
  items: ReplayItem[];
  sourceMessages: CapturedReplayMessage[];
  selected: boolean;
  preview: string;
}

export interface NativeReplayToolResult {
  replayToolCallId: string;
  originalToolCallId: string;
  toolName: string;
  content: ToolResultMessage["content"];
  details?: unknown;
  usage?: ToolResultMessage["usage"];
  isError: boolean;
}

export interface NativeReplayTurn {
  id: string;
  sourceEntryIds: string[];
  user: UserMessage;
  responses: AssistantMessage[];
}

export interface ReplayScript {
  id: string;
  originalSessionId: string;
  originalSessionFile: string;
  temporarySessionId?: string;
  temporarySessionFile?: string;
  createdAt: number;
  originalModel?: ReplaySource["model"];
  replayModelId: string;
  options: ReplayOptions;
  turns: NativeReplayTurn[];
  responses: AssistantMessage[];
  responseCursor: number;
  turnCursor: number;
  toolResults: Map<string, NativeReplayToolResult>;
  status: "prepared" | "running" | "finished" | "restoring" | "cancelled";
}

export interface ReplaySnapshot {
  source: ReplaySource;
  turns: ReplayTurn[];
}
