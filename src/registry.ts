import type { ReplayScript } from "./types.js";

const REGISTRY_SYMBOL = Symbol.for("pi-replay/registry/v1");

interface ReplayRegistry {
  version: 1;
  scripts: Map<string, ReplayScript>;
  bySessionId: Map<string, string>;
  bySessionFile: Map<string, string>;
}

function createRegistry(): ReplayRegistry {
  return {
    version: 1,
    scripts: new Map(),
    bySessionId: new Map(),
    bySessionFile: new Map(),
  };
}

export function getReplayRegistry(): ReplayRegistry {
  const globalRecord = globalThis as typeof globalThis & { [REGISTRY_SYMBOL]?: ReplayRegistry };
  const current = globalRecord[REGISTRY_SYMBOL];
  if (current?.version === 1) return current;
  const registry = createRegistry();
  globalRecord[REGISTRY_SYMBOL] = registry;
  return registry;
}

export function registerReplayScript(script: ReplayScript): void {
  const registry = getReplayRegistry();
  for (const [id, existing] of registry.scripts) {
    if (existing.originalSessionId === script.originalSessionId
      && existing.status === "prepared"
      && !existing.temporarySessionId) {
      registry.scripts.delete(id);
    }
  }
  registry.scripts.set(script.id, script);
}

export function getReplayScriptById(scriptId: string): ReplayScript | undefined {
  return getReplayRegistry().scripts.get(scriptId);
}

export function listReplayScripts(): ReplayScript[] {
  return [...getReplayRegistry().scripts.values()];
}

export function findLatestPreparedReplayScript(): ReplayScript | undefined {
  return listReplayScripts()
    .filter((script) => script.status === "prepared" && !script.temporarySessionId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

export function bindReplaySession(scriptId: string, sessionId: string, sessionFile?: string): ReplayScript {
  const registry = getReplayRegistry();
  const script = registry.scripts.get(scriptId);
  if (!script) throw new Error(`Unknown replay script: ${scriptId}`);
  script.temporarySessionId = sessionId;
  script.temporarySessionFile = sessionFile;
  registry.bySessionId.set(sessionId, scriptId);
  if (sessionFile) registry.bySessionFile.set(sessionFile, scriptId);
  return script;
}

export function findReplayScript(sessionId?: string, sessionFile?: string): ReplayScript | undefined {
  const registry = getReplayRegistry();
  const scriptId = sessionId
    ? registry.bySessionId.get(sessionId)
    : sessionFile ? registry.bySessionFile.get(sessionFile) : undefined;
  return scriptId ? registry.scripts.get(scriptId) : undefined;
}

export function removeReplayScript(scriptId: string): void {
  const registry = getReplayRegistry();
  const script = registry.scripts.get(scriptId);
  if (!script) return;
  if (script.temporarySessionId) registry.bySessionId.delete(script.temporarySessionId);
  if (script.temporarySessionFile) registry.bySessionFile.delete(script.temporarySessionFile);
  registry.scripts.delete(scriptId);
}

export function resetReplayRegistryForTests(): void {
  const registry = getReplayRegistry();
  registry.scripts.clear();
  registry.bySessionId.clear();
  registry.bySessionFile.clear();
}
