import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deleteVerifiedTemporarySession } from "../src/session/temporary-session.js";

test("deletes only an exactly matching temporary session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-replay-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ type: "session", version: 3, id: "expected", cwd: dir })}\n`);
  await assert.rejects(() => deleteVerifiedTemporarySession(file, "wrong"), /header mismatch/);
  assert.ok((await readFile(file, "utf8")).includes("expected"));
  assert.equal(await deleteVerifiedTemporarySession(file, "expected"), true);
  await assert.rejects(() => readFile(file, "utf8"), /ENOENT/);
});
