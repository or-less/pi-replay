import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReplayCommand } from "./command.js";
import { registerReplayProvider } from "./provider/replay-provider.js";
import { registerReplayActivationCommand } from "./session/activate-replay.js";
import { registerReplayToolResultRestorer } from "./tools/mock-tools.js";

export default function replayExtension(pi: ExtensionAPI): void {
  registerReplayProvider(pi);
  registerReplayToolResultRestorer(pi);
  registerReplayActivationCommand(pi);
  registerReplayCommand(pi);
}
