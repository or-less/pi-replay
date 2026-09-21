import assert from "node:assert/strict";
import test from "node:test";
import { parseReplayArgs } from "../src/args.js";

test("parses replay options", () => {
  assert.deepEqual(parseReplayArgs("--full --last 3 --speed 2 --no-tools --thinking"), {
    full: true,
    last: 3,
    speed: 2,
    showTools: false,
    showThinking: true,
  });
});

test("accepts arbitrary replay speeds in the supported range", () => {
  assert.equal(parseReplayArgs("--speed 0.1").speed, 0.1);
  assert.equal(parseReplayArgs("--speed 3").speed, 3);
  assert.equal(parseReplayArgs("--speed 16").speed, 16);
  assert.equal(parseReplayArgs("--speed 100").speed, 100);
});

test("rejects invalid options", () => {
  assert.throws(() => parseReplayArgs("--last 0"), /positive integer/);
  assert.throws(() => parseReplayArgs("--speed 0"), /from 0.1 to 100/);
  assert.throws(() => parseReplayArgs("--speed 101"), /from 0.1 to 100/);
  assert.throws(() => parseReplayArgs("--speed Infinity"), /from 0.1 to 100/);
  assert.throws(() => parseReplayArgs("--wat"), /Unknown replay option/);
});
