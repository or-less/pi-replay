import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { ReplayTurn } from "../types.js";

export interface SelectionResult {
  turns: ReplayTurn[];
}

export class ReplaySelectionView implements Component {
  private cursor = 0;
  private warning = false;

  constructor(
    private readonly turns: ReplayTurn[],
    private readonly theme: Theme,
    private readonly done: (result: SelectionResult | undefined) => void,
    private readonly requestRender: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (this.turns.some((turn) => turn.selected)) this.done({ turns: this.turns });
      else {
        this.warning = true;
        this.requestRender();
      }
      return;
    }
    this.warning = false;
    if (matchesKey(data, Key.up)) this.cursor = Math.max(0, this.cursor - 1);
    else if (matchesKey(data, Key.down)) this.cursor = Math.min(this.turns.length - 1, this.cursor + 1);
    else if (matchesKey(data, Key.space)) {
      const turn = this.turns[this.cursor];
      if (turn) turn.selected = !turn.selected;
    } else if (data.toLowerCase() === "a") {
      for (const turn of this.turns) turn.selected = true;
    } else if (data.toLowerCase() === "n") {
      for (const turn of this.turns) turn.selected = false;
    }
    this.requestRender();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(10, width - 2);
    const lines = [
      this.theme.fg("accent", this.theme.bold("Pi Replay · 选择要显示的对话")),
      this.theme.fg("dim", "↑↓ 移动 · Space 切换 · A 全选 · N 全不选 · Enter 开始 · Esc 取消"),
      "",
    ];

    const maxVisible = 16;
    const start = Math.max(0, Math.min(this.cursor - Math.floor(maxVisible / 2), this.turns.length - maxVisible));
    const visible = this.turns.slice(start, start + maxVisible);
    visible.forEach((turn, relativeIndex) => {
      const index = start + relativeIndex;
      const active = index === this.cursor;
      const marker = active ? "›" : " ";
      const checked = turn.selected ? "[x]" : "[ ]";
      const label = `${marker} ${checked} ${String(turn.index + 1).padStart(2, "0")}  ${turn.preview}`;
      const text = truncateToWidth(label, innerWidth);
      lines.push(active ? this.theme.fg("accent", text) : this.theme.fg(turn.selected ? "text" : "dim", text));
    });

    lines.push("");
    const selected = this.turns.filter((turn) => turn.selected).length;
    lines.push(this.theme.fg(selected > 0 ? "success" : "warning", `已选择 ${selected}/${this.turns.length} 轮`));
    if (this.warning) lines.push(this.theme.fg("warning", "请至少选择一轮对话"));
    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}
  dispose(): void {}
}
