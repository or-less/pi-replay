import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { registerReplayCommand } from "../src/command.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("command rejects ephemeral sessions without mutating them", async () => {
  const manager = SessionManager.inMemory("/tmp/replay-test");
  manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
  const before = JSON.stringify(manager.getEntries());

  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const pi = {
    on: () => {},
    registerCommand: (_name: string, options: { handler: typeof handler }) => {
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  registerReplayCommand(pi);
  assert.ok(handler);

  let customCount = 0;
  const ui = {
    notify: () => {},
    custom: async <T>(factory: (
      tui: { requestRender(): void },
      theme: Theme,
      keybindings: unknown,
      done: (result: T) => void,
    ) => Component): Promise<T> => new Promise<T>((resolve) => {
      customCount += 1;
      const component = factory({ requestRender() {} }, theme, {}, resolve);
      component.handleInput?.(customCount === 1 ? "\r" : "\x1b");
    }),
  };
  const ctx = {
    hasUI: true,
    isIdle: () => true,
    sessionManager: manager,
    ui,
  } as unknown as ExtensionCommandContext;

  await handler!("", ctx);
  assert.equal(customCount, 0);
  assert.equal(JSON.stringify(manager.getEntries()), before);
  assert.equal(manager.getLeafId(), manager.getEntries().at(-1)?.id);
});
