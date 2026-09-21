# Pi Replay

Pi Replay 是面向 Pi 和 Pi Web 的原生 session 回放扩展。它把当前会话复制成回放脚本，在全新的临时 session 中通过本地 Provider 逐字播放；用户消息、Markdown、thinking 和工具卡片均由 Pi 自身渲染。

回放不调用真实模型、不产生模型费用、不执行历史工具，也不会改写原 session。返回后，临时 session 会在校验身份后自动删除。

## 兼容性

当前版本针对以下版本开发并测试：

- `@agegr/pi-web` 0.9.1
- `@earendil-works/pi-coding-agent` 0.85.1
- `@earendil-works/pi-tui` 0.85.1
- Node.js 22.19+

## 安装

从 GitHub 安装：

```bash
pi install git:github.com/or-less/pi-replay
```

使用 SSH 地址也可以：

```bash
pi install git:git@github.com:or-less/pi-replay.git
```

临时试用而不写入配置：

```bash
pi -e git:github.com/or-less/pi-replay
```

安装后，在 Pi / Pi Web 中执行 `/reload`。

更新扩展：

```bash
pi update --extensions
```

从源码进行本地开发：

```bash
git clone git@github.com:or-less/pi-replay.git
cd pi-replay
npm install
pi install "$PWD"
```

如果之前安装的是本地路径版本，请先执行：

```bash
pi remove /home/doctor/project/pi-replay
pi install git:github.com/or-less/pi-replay
```

## 使用

```text
/replay
/replay --context
/replay --last 3
/replay --speed 16
/replay --no-tools
/replay --thinking
```

参数：

- 默认：回放当前活动分支的完整历史，包括压缩前仍保留在分支中的消息。
- `--context`：只回放 Pi 当前压缩感知的有效上下文。
- `--full`：显式选择完整历史；为兼容旧用法保留。
- `--last N`：在所选范围内只回放最后 N 个用户轮次。
- `--speed N`：设置流式速度，支持 `0.1` 到 `100`。文本在 0.1–4× 保持逐 grapheme；更高倍速会合并多个 grapheme。工具参数（bash、read、edit 等）从 1× 以上就开始分块加速。
- `--no-tools`：隐藏工具调用和结果。
- `--thinking`：包含已保存的 thinking 内容。

## 选择轮次

执行 `/replay` 后先打开轮次选择器：

- `↑/↓`：移动
- `Space`：显示或隐藏当前轮次
- `A`：全部显示
- `N`：全部隐藏
- `Enter`：开始回放
- `Esc`：取消

终端版确认后会自动切换到名为 `Replay · …` 的临时 session。回放结束时选择 **Yes** 会恢复原 session 并删除临时文件；选择 **No** 可停留查看，之后执行 `/replay-exit` 返回。

Pi Web 0.9.1 明确禁止扩展调用 `ctx.newSession()` 和 `ctx.switchSession()`，因此使用安全的两步流程：

1. 在原 session 执行 `/replay` 并完成轮次选择。
2. 点击 Pi Web 左侧的 `+` 新建空白 session。
3. 在新 session 执行 `/replay-start`。
4. 完成后从左侧会话列表返回原 session。

回放仍使用原生消息管线；临时文件在完成或中断后自动清理。

## 安全模型

- **本地 Provider**：助手内容来自内存中的回放脚本，不发起网络或模型请求。界面沿用原 session 的模型名称；Provider 仍标识为 `pi-replay`，避免误调用真实模型。
- **Mock 工具**：同名工具只返回保存的历史结果，不运行 `bash`、`read`、`edit`、`write` 或第三方工具实现。
- **原 session 不变**：回放消息只写入临时 session。
- **安全清理**：删除前会核对临时 JSONL 的 session header 与预期 ID；不匹配则拒绝删除。
- **原生渲染**：正文进入正常 AgentSession 事件管线，不使用自绘播放器。

## 已知限制

- Session 没有 token 到达时间，因此流式间隔是确定性的模拟值；高倍速会以 grapheme chunk 显示，而非复刻原始 token 分块。
- 历史工具通常只保存最终结果，无法复刻原始工具输出增量。
- 回放脚本保存在当前 Pi 进程内；在执行 `/replay-start` 前重启 Pi Web 会丢失已准备的脚本。
- Pi Web 0.9.1 不开放扩展驱动的 session 切换，所以 Web 端需要手动新建和返回 session；终端版仍为自动切换。
- 当前不包含录屏、视频导出、跨 session 回放和筛选 preset。

## 开发与验证

```bash
npm install
npm run typecheck
npm test
```

自动测试覆盖脚本编译、grapheme 流式事件、工具 ID 重写、Mock 工具、错误状态恢复及临时文件安全删除。当前版本也已在 Pi TUI 中实测完整的“选择 → 新 session → 原生流式消息/工具卡片 → 恢复 → 清理”流程。

完整架构与阶段规划见 [`PLAN.md`](./PLAN.md)。
