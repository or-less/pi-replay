import type { ReplayOptions, ReplaySpeed } from "./types.js";

export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = {
  full: false,
  speed: 1,
  showTools: true,
  showThinking: false,
};

export const MIN_REPLAY_SPEED = 0.1;
export const MAX_REPLAY_SPEED = 100;

export function parseReplayArgs(input: string): ReplayOptions {
  const options = { ...DEFAULT_REPLAY_OPTIONS };
  const tokens = input.trim() ? input.trim().split(/\s+/) : [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    switch (token) {
      case "--full":
        options.full = true;
        break;
      case "--no-tools":
        options.showTools = false;
        break;
      case "--thinking":
        options.showThinking = true;
        break;
      case "--last": {
        const value = tokens[++index];
        const count = Number(value);
        if (!value || !Number.isInteger(count) || count < 1) {
          throw new Error("--last requires a positive integer");
        }
        options.last = count;
        break;
      }
      case "--speed": {
        const value = tokens[++index];
        const speed = Number(value) as ReplaySpeed;
        if (!value || !Number.isFinite(speed) || speed < MIN_REPLAY_SPEED || speed > MAX_REPLAY_SPEED) {
          throw new Error(`--speed must be a number from ${MIN_REPLAY_SPEED} to ${MAX_REPLAY_SPEED}`);
        }
        options.speed = speed;
        break;
      }
      default:
        throw new Error(`Unknown replay option: ${token}`);
    }
  }

  return options;
}
