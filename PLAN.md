# Pi Replay 实施计划（原生会话回放方案）

> 状态：0.2.4 原生 Provider/TUI 完成；Pi Web 0.9.1 改用手动新建/返回 session 的两步流程
> 目标版本：0.2.4
> 目标环境：Pi Web 0.9.1、Pi Coding Agent/TUI 0.85.1

## 1. 目标定义

`/replay` 必须表现为一个真正重新开始的新 session，而不是在扩展面板里模拟聊天。

回放期间应满足：

- 进入一个空白的临时 session。
- 用户消息通过 Pi 原生消息流程出现。
- 助手消息通过 Pi 原生 streaming event 逐字输出。
- Markdown、代码块、thinking、错误状态使用 Pi 自己的 renderer。
- 工具调用和工具结果使用 Pi 原生 Tool UI。
- Pi Web 使用原生 React 对话界面。
- Pi TUI 使用原生终端对话界面。
- 不访问真实模型接口。
- 不执行历史工具产生的真实副作用。
- 原 session 不被修改。
- 回放完成后停留在最终画面。
- 用户确认退出后自动切回原 session，并删除临时 session。

“渲染一致”的定义是：回放消息进入与真实对话相同的 `AgentSession` 事件管线，由 Pi Web/TUI 自己渲染；扩展不自行绘制消息正文。

### Pi Web 0.9.1 的宿主限制

实机验证确认 Pi Web 0.9.1 在 `createExtensionCommandContextActions()` 中把扩展调用的 `newSession`、`fork`、`switchSession` 固定实现为 `{ cancelled: true }`。因此自动 session 切换只适用于 TUI；Web 端采用 `/replay` 准备脚本 → 用户点击 `+` 新建 session → `/replay-start` → 用户从会话列表返回的两步流程。正文仍由原生 AgentSession 渲染，且历史工具仍只运行 mock。

## 2. 为什么废弃旧方案

0.1.0 使用 `ctx.ui.custom()` 绘制选择器和播放器。该方案存在无法修复的结构性问题：

- Custom UI 在 Pi Web 中是 ANSI 行面板，不是原生 React 消息列表。
- Custom UI 在 TUI 中替换编辑器区域，不是正常 chat transcript。
- 即使模拟 Markdown 和颜色，也无法复用正常消息、工具、thinking 的完整 renderer。
- Custom UI 高频刷新经过桥接和前端状态合并，不能保证逐字动画。

因此：

- 保留 Custom UI 仅用于回放前的轮次选择。
- 删除 Custom UI 播放器。
- 播放阶段改为临时原生 session + 本地 replay provider。

## 3. 新架构概览

```text
原 session
   │
   ├─ /replay
   ├─ 快照活动分支
   ├─ 选择需要显示的轮次
   ├─ 编译 ReplayScript
   │
   └─ ctx.newSession()
         │
         ├─ 创建临时 session
         ├─ 写入 replay marker
         ├─ 将模型设为 pi-replay/replay
         ├─ 新扩展实例读取全局 ReplayRegistry
         ├─ 注册本地 replay provider
         ├─ 覆盖本次脚本涉及的工具
         │
         └─ 逐轮调用 sendUserMessage()
               │
               ├─ 原生 user message event
               ├─ replay provider 发出原生 assistant stream
               ├─ Pi 执行 mock tool
               ├─ 原生 tool result event
               └─ Pi Web/TUI 原生渲染

回放结束
   │
   ├─ 保持最终画面
   ├─ 用户确认退出
   ├─ switchSession(originalSessionFile)
   └─ 删除临时 session 文件和 Registry 数据
```

## 4. 核心技术方案

### 4.1 本地 Replay Provider

扩展注册一个完整的本地 provider：

```text
provider: pi-replay
model: replay
api: pi-replay-stream
```

Provider 特征：

- 无 API key。
- 无 HTTP 请求。
- cost 全部为 0。
- 从内存 ReplayRegistry 读取下一条历史 assistant response。
- 使用 `createAssistantMessageEventStream()` 输出标准事件。

事件顺序严格遵循 Pi 协议：

```text
start
text_start
text_delta × N
text_end
toolcall_start
toolcall_delta × N
toolcall_end
done
```

thinking 使用：

```text
thinking_start
thinking_delta × N
thinking_end
```

错误或中止使用标准 `error` terminal event。

### 4.2 真正逐字输出

旧版以多字符 chunk 模拟，Pi Web 可能将更新合并。新版要求：

- 使用 `Intl.Segmenter(..., { granularity: "grapheme" })`。
- 每个 `text_delta` 只携带一个 grapheme。
- 中文字符逐字输出。
- emoji、ZWJ emoji、组合字符不会被拆坏。
- 每次 delta 后真实等待，不一次性预生成后同步 push。
- 默认基础延迟 45ms。
- 标点和换行增加停顿。

默认节奏：

| 内容 | 延迟 |
|---|---:|
| 普通字符 | 45ms |
| 逗号、分号 | 90ms |
| 句号、问号、感叹号 | 180ms |
| 换行 | 120ms |
| 用户消息后 | 450ms |
| 工具调用前 | 300ms |
| 工具结果后 | 450ms |
| 轮次之间 | 650ms |

速度倍率作用于全部延迟：

```text
actualDelay = baseDelay / speed
```

Provider 必须监听 `AbortSignal`；中止时停止等待和推流。

### 4.3 原生用户消息

每个选中的历史用户消息通过临时 session 的：

```ts
await ctx.sendUserMessage(content)
```

发送。

结果：

- Pi 自己创建 user message entry。
- Pi Web 使用正常用户气泡。
- TUI 使用正常 `UserMessageComponent`。
- 图片内容沿用 Pi 原生 user content，不转成文本占位。

不得直接 append message 来代替，因为 append 不会产生完整实时 UI 事件。

### 4.4 原生助手消息

`sendUserMessage()` 会触发临时 session 的 agent loop。当前模型为 `pi-replay/replay`，因此不会访问真实模型，而是调用 Replay Provider。

Provider 从对应 turn 中依次返回历史 assistant message：

- 保留原始 content block 顺序。
- 保留 text。
- 可选保留 thinking。
- 保留 toolCall 名称和参数。
- 为 replay session 使用稳定且不冲突的 toolCall ID。
- usage 设为 0，避免把历史费用再次计入。
- provider/model 字段使用 replay provider，确保协议内部一致。

### 4.5 原生工具调用与结果

为了让 Pi Web/TUI 使用正常工具卡片，历史 tool call 必须真的进入 agent loop；但工具实现必须是 mock，绝不能执行真实操作。

临时 session 启动时：

1. 收集 ReplayScript 中所有工具名称。
2. 用相同名称注册 mock tool，覆盖 built-in/extension tool 的 execute。
3. 参数 schema 使用可接受历史参数的宽松 schema。
4. mock execute 根据 toolCall ID 从 ReplayRegistry 取出历史结果。
5. 返回原始 `content`、`details`、`usage`。
6. 对历史错误结果，通过 `tool_result` hook 恢复 `isError: true`。

由于 Pi 的 renderer slot 可继承 built-in renderer：

- `read`、`bash`、`edit`、`write` 等继续使用原生工具样式。
- 第三方工具若 renderer 不可恢复，则使用 Pi 自带 fallback，而不是扩展自绘。

安全约束：mock 工具中不得调用原工具、shell、文件系统或网络。

### 4.6 多工具和 agent loop

历史 assistant response 若包含工具调用，Pi 会：

1. 原生流式展示 tool call。
2. 执行 mock tool。
3. 发出原生 tool result。
4. 自动再次请求 replay provider。

Replay Provider 的响应队列必须与历史顺序一致：

```text
user 1
  assistant A (toolUse)
  tool result A
  assistant B (stop)
user 2
  assistant C (stop)
```

只有当一个历史 assistant response 以非 tool-use 状态结束时，当前 `sendUserMessage()` 才结束，编排器再发送下一条历史用户消息。

并行工具：

- tool call 顺序沿用 assistant content 顺序。
- mock execute 可并行调用。
- 每个结果按 toolCall ID 精确匹配。
- 不依赖“下一个结果”这样的全局 FIFO。

## 5. ReplayScript 数据模型

```ts
interface ReplayScript {
  id: string;
  originalSessionId: string;
  originalSessionFile: string;
  temporarySessionId?: string;
  temporarySessionFile?: string;
  createdAt: number;
  options: ReplayOptions;
  turns: NativeReplayTurn[];
  responseCursor: number;
  toolResults: Map<string, NativeReplayToolResult>;
  status: "prepared" | "running" | "finished" | "restoring" | "cancelled";
}

interface NativeReplayTurn {
  id: string;
  sourceEntryIds: string[];
  user: UserMessage;
  responses: AssistantMessage[];
}

interface NativeReplayToolResult {
  replayToolCallId: string;
  originalToolCallId: string;
  toolName: string;
  content: ToolResultMessage["content"];
  details?: unknown;
  usage?: Usage;
  isError: boolean;
}
```

ReplayScript 在切换 session 前完整构建，播放期间不再读取原 SessionManager。

## 6. ReplayRegistry

Session replacement 会销毁旧扩展实例并创建新扩展实例，因此不能把脚本只存在旧实例闭包中。

使用进程级版本化 registry：

```ts
Symbol.for("pi-replay/registry/v1")
```

Registry 保存：

- `scriptId -> ReplayScript`
- `temporarySessionId -> scriptId`
- `temporarySessionFile -> scriptId`

规则：

- 仅存当前进程内存，不写入原 session。
- 临时 session 中写入最小 replay marker，供新扩展实例识别。
- session shutdown、恢复完成、异常退出时幂等清理。
- 不把完整历史脚本写进临时 session 文件，避免复制敏感内容。
- 新实例在 `session_start` 中用 session ID 查找脚本并激活 mock 工具。

## 7. 临时 Session 生命周期

### 7.1 前置条件

原 session 必须是持久化 session，并存在 `sessionFile`，否则无法可靠自动恢复。

对于 ephemeral session：

- 第一版拒绝原生回放。
- 明确提示先保存/创建持久 session。

### 7.2 创建

使用：

```ts
ctx.newSession({
  parentSession: originalSessionFile,
  setup: async (sessionManager) => {
    // 注册 script 与 temporary session id
    // append replay marker
    // append model change: pi-replay/replay
    // 设置临时 session 名称
  },
  withSession: async (replayCtx) => {
    // 仅使用 replayCtx，不使用旧 ctx/pi
  }
})
```

临时 session 名称：

```text
Replay · <原 session 名称或时间>
```

### 7.3 播放

`withSession` 中按 turn 顺序：

```ts
for (const turn of script.turns) {
  await replayCtx.sendUserMessage(turn.user.content)
  await delay(turnGap)
}
```

每个用户消息触发的所有 assistant/tool continuation 由 agent loop 和 Replay Provider 自动完成。

### 7.4 完成画面

最后一轮完成后：

- 不立即切走。
- 保持完整临时 session 画面。
- 显示轻量状态或确认 UI：`回放完成，退出后返回原 session`。
- 用户确认或按退出键后开始恢复。

播放正文区域不得出现自绘播放器面板。

### 7.5 恢复

使用临时 session 的新鲜 command context：

```ts
await replayCtx.switchSession(originalSessionFile, {
  withSession: async () => {
    // 已恢复原 session
    // 删除临时 session 文件
    // 清理 ReplayRegistry
  }
})
```

严格遵守 session replacement 规则：

- replacement 后不得使用旧 `pi`。
- replacement 后不得使用旧 `ctx`。
- 不得复用旧 SessionManager。
- callback 之间只传递字符串、ID、序列化配置等普通数据。

## 8. 临时文件清理

正常路径：

1. 切回原 session。
2. 确认当前 session 已恢复。
3. 删除临时 `.jsonl` 文件。
4. 删除 registry entry。

异常路径：

- 如果回放中止，仍进入恢复流程。
- 如果切回失败，保留临时 session 文件，避免把用户困在不可恢复状态。
- 如果删除失败，通知用户临时文件路径，不影响原 session。
- 启动时可扫描带 replay marker 且已完成的临时 session，提供后续清理，但第一版不自动删除未知进程遗留文件。

删除操作仅允许针对 registry 中记录、且 header/session ID 匹配的临时文件。不得根据文件名模糊删除。

## 9. 轮次选择

选择器仍可使用 `ctx.ui.custom()`，因为它只负责配置，不负责播放正文。

流程：

- 在原 session 中打开选择器。
- 按用户消息划分 turn。
- Space 显示/隐藏。
- Enter 后先编译完整 ReplayScript。
- 编译成功后才切换 session。

支持：

```text
/replay
/replay --context
/replay --full
/replay --last N
/replay --speed N  # 0.1–100 的任意数字
/replay --no-tools
/replay --thinking
```

语义：

- `/replay`：默认回放当前活动分支的完整原始对话路径，包括压缩前消息。
- `--context`：只使用压缩感知的当前有效上下文。
- `--full`：显式选择完整历史，为兼容旧用法保留。
- `--last N`：在所选范围内保留最后 N 个用户轮次。
- `--speed`：原生 provider 的逐字速度，接受 0.1–100 的任意有限数字。
- `--no-tools`：不生成 tool call；对应历史工具阶段使用简短跳过策略。
- `--thinking`：回放 thinking block。

## 10. 中止与控制

### 10.1 中止

在真实 agent streaming 期间，Pi Web/TUI 自带的 Stop/Esc 会触发 AbortSignal：

- Replay Provider 立即停止 delta。
- mock 工具立即返回/中止。
- 编排器将 script 标记为 cancelled。
- 提示用户恢复原 session。

### 10.2 调速

由于播放走原生 agent loop，不能再用 Custom UI 截获 Space/数字键。

第一版：

- 初始速度通过 `/replay --speed N` 设置。
- 回放中不提供快捷键动态调速。
- 后续可增加 `/replay-speed N` 命令，通过 registry 修改后续 delta 延迟。

### 10.3 暂停

第一版原生方案暂不提供中途暂停，因为暂停 agent stream 会与 Pi 自己的 abort/queue 语义冲突。

后续可实现 `/replay-pause`，让 Provider 在 delta 间等待 registry condition，而不是阻塞 UI。

## 11. 对话编译规则

### 11.1 保留

- user message 文本和图片。
- assistant text block。
- assistant thinking block（开启时）。
- assistant toolCall block。
- toolResult content/details/isError。
- assistant error/aborted 状态。

### 11.2 忽略或降级

- model change：临时 session 固定使用 replay model。
- thinking level change：由 `--thinking` 控制。
- label/session info：不属于对话正文。
- compaction entry：不直接播放；使用活动分支中的原始消息。
- branch summary：默认不作为用户/助手消息播放。
- extension custom message：第一版仅播放可安全映射为 user/assistant 的内容，否则跳过并记录诊断。
- `bashExecution` 用户命令：第一版不真正执行；后续设计原生安全展示方式。

### 11.3 Tool Call ID 重写

为避免不同历史 turn 中重复 toolCall ID：

```text
replay:<scriptId>:<turnIndex>:<responseIndex>:<blockIndex>
```

同时保存 original ID 到 replay ID 的映射。tool result 按 replay ID 查找，不能只按工具名或 FIFO 匹配。

## 12. 代码结构调整

```text
src/
├── index.ts
├── command.ts
├── args.ts
├── types.ts
├── registry.ts
├── provider/
│   ├── replay-provider.ts
│   ├── stream-response.ts
│   └── timing.ts
├── session/
│   ├── snapshot.ts
│   ├── compile-script.ts
│   ├── group-turns.ts
│   ├── temporary-session.ts
│   └── cleanup.ts
├── tools/
│   ├── mock-tools.ts
│   └── result-router.ts
└── ui/
    └── selection-view.ts
```

将删除或停止使用：

```text
src/ui/player-view.ts
src/replay/controller.ts
src/replay/timeline.ts
```

`segmenter.ts` 可重构为 provider timing 模块。

## 13. 实施阶段

### Phase A：删除旧播放器路径 ✅

- 保留参数、快照和选择器。
- 移除 Custom UI 播放器入口。
- 标记 0.1.0 架构废弃。

验收：代码中不再使用自绘播放器展示回放正文。

### Phase B：ReplayScript 编译 ✅

- 从活动分支生成 user turn。
- 保留 assistant content block 原始顺序。
- 配对并重写 toolCall ID。
- 构建 response queue 和 tool result map。

验收：复杂 fixture 编译后的脚本顺序与原始历史一致。

### Phase C：本地 Provider ✅

- 注册 `pi-replay/replay`。
- 实现 grapheme 逐字 delta。
- 实现 thinking/tool call 标准事件。
- 实现 AbortSignal。
- usage/cost 归零。

验收：直接消费 stream 时每个中文 grapheme 都对应独立 delta，且无网络访问。

### Phase D：Mock 工具 ✅

- 动态覆盖脚本所需工具。
- 根据 replay toolCall ID 返回历史结果。
- 恢复 isError/details/images。
- 验证没有原工具执行。

验收：read/bash/edit 等历史调用显示原生工具卡片，文件系统无变化。

### Phase E：临时 session 编排 ✅（TUI 实机通过）

- 注册 registry。
- 创建临时 session。
- 恢复 replay model。
- 顺序发送 user message。
- 完成后等待退出。
- 切回原 session并清理。

验收：Pi Web/TUI 都表现为从空白 session 开始的正常对话。

### Phase F：异常恢复与文档 ✅（Pi Web 实机验收待完成）

- 中止、provider 错误、工具结果缺失处理。
- session switch 失败处理。
- 临时文件安全校验和清理。
- 更新 README 和安装说明。

验收：失败不会修改原 session，也不会执行真实工具。

## 14. 测试计划

### 14.1 Provider 协议测试

- start 必须最先出现。
- 每个 text/thinking grapheme 单独 delta。
- block index 正确。
- toolcall JSON delta 可拼回原参数。
- done/error 顺序合法。
- AbortSignal 能中止 delay。
- stream 不产生 fetch/http 调用。

### 14.2 Script 编译测试

- 多用户轮次。
- 一个 turn 多次 assistant continuation。
- text → toolCall → text block 顺序。
- 并行工具。
- 重复原始 toolCall ID。
- 孤立 toolResult。
- thinking 开关。
- 图片 user/tool result。
- error/aborted assistant。
- compaction 后活动分支。

### 14.3 Mock 工具安全测试

- mock read 不读取文件。
- mock bash 不启动进程。
- mock edit/write 不修改文件。
- 未匹配结果返回明确 replay error。
- 历史 isError 得到恢复。

### 14.4 Session 生命周期测试

- 原 session entries/leaf/file hash 不变。
- 临时 session 从空白开始。
- 临时 session 使用 replay model。
- 正常结束切回原 session。
- 中止后切回原 session。
- switch 失败时保留临时 session。
- 仅删除 ID 精确匹配的临时文件。
- registry 在完成后为空。

### 14.5 实机验收

Pi Web：

- 用户消息气泡与正常对话一致。
- Markdown/代码块与正常对话一致。
- 明显逐字输出，而非整段出现。
- 工具卡片与正常执行一致。
- 页面只显示正常 session UI，不显示回放正文面板。

Pi TUI：

- UserMessageComponent/AssistantMessageComponent 由 Pi 原生创建。
- 工具 renderer 与正常对话一致。
- Esc 可中止 stream。
- 返回原 session 后焦点和编辑器正常。

## 15. 安全不变量

实现和测试必须持续保证：

1. 原 session 不 append、不 branch、不改 leaf。
2. 不请求真实模型。
3. 不执行真实工具。
4. 不执行历史 bash 命令。
5. 不应用历史 edit/write 操作。
6. 临时 session 删除前必须校验 session ID。
7. session replacement 后不使用 stale `pi`、`ctx`、SessionManager。
8. 任意异常均优先保证用户能返回原 session。

## 16. 完成定义

0.2.0 只有同时满足以下条件才算完成：

- 回放正文完全不使用 Custom UI 绘制。
- 回放从新的空白临时 session 开始。
- Pi Web/TUI 都通过原生 message/tool event 渲染。
- 中文和 emoji 按 grapheme 逐字输出。
- 历史工具只执行 mock，原生工具卡片正常显示。
- 原 session 文件 hash、entries、leaf 均不变化。
- 退出后恢复原 session。
- 临时 session 正常删除。
- Provider、工具、安全、生命周期测试全部通过。
- Pi Web 和 TUI 实机验收通过。
