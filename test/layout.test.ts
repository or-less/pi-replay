import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ReplaySelectionView } from "../src/ui/selection-view.js";
import type { ReplayTurn } from "../src/types.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("selection view never exceeds available width", () => {
  const turns: ReplayTurn[] = [{
    id: "turn:1",
    index: 0,
    entryIds: ["1"],
    selected: true,
    preview: "这是一个很长的中文预览文本 with emoji 🚀 and more content",
    items: [],
    sourceMessages: [],
  }];
  const view = new ReplaySelectionView(turns, theme, () => {}, () => {});
  const lines = view.render(24);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
});
