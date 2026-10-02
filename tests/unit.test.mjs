import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sessionFor } from "../src/session.ts";
import { encodeFrame, processIdentity, resolveScope, writeFrame } from "../src/transport.ts";

const token = "a".repeat(32);
const env = { TERM_PROGRAM: "pebrel", WSL_DISTRO_NAME: "test", PEBREL_PANE_ID: "999", PEBREL_REMOTE_HOOK_TOKEN: token };

test("scope requires all independent checks and accepts legacy aliases", () => {
  assert.deepEqual(resolveScope(env, "linux"), { token });
  assert.equal(resolveScope(env, "win32"), undefined);
  assert.equal(resolveScope(env, "darwin"), undefined);
  for (const change of [{ TERM_PROGRAM: "other" }, { WSL_DISTRO_NAME: "" }, { PEBREL_PANE_ID: "bad" },
    { PEBREL_REMOTE_HOOK_TOKEN: "bad" }, { PEBREL_REMOTE_HOOK_TOKEN: undefined }]) {
    assert.equal(resolveScope({ ...env, ...change }, "linux"), undefined);
  }
  const legacy = { ...env, PEBREL_REMOTE_HOOK_TOKEN: undefined, NEBULA_REMOTE_HOOK_TOKEN: token };
  assert.deepEqual(resolveScope(legacy, "linux"), { token });
});

test("Linux identity accounts for spaces and closing parentheses in comm", () => {
  const fields = ["S", ...Array(18).fill("0"), "12345", "0"];
  assert.equal(processIdentity(`42 (name ) with spaces) ${fields.join(" ")}`, 42), "42:12345");
  assert.throws(() => processIdentity("malformed", 42));
  assert.match(processIdentity(), new RegExp(`^${process.pid}:\\d+$`));
});

test("OSC wire shape is compatible, bounded, and UTF-8 preserving", () => {
  const frame = encodeFrame({ token }, "42:123", { kind: "done", cwd: "/home/中文", bridge_sequence: "1" });
  const match = /^\x1b\]777;nebula-hook;([a-f0-9]{32});([A-Za-z0-9+/=]+)\x07$/.exec(frame.toString());
  assert.equal(match[1], token);
  const [header, raw] = Buffer.from(match[2], "base64").toString().split("\n");
  assert.equal(header, "nebula-hook/1 source=pi process=42:123");
  assert.equal(JSON.parse(raw).cwd, "/home/中文");
  assert.throws(() => encodeFrame({ token: "bad" }, "42:123", {}));
  assert.throws(() => encodeFrame({ token }, "not-a-process", {}));
  assert.throws(() => encodeFrame({ token }, "42:123", { x: "x".repeat(65536) }));
});

function mockIO(write) {
  let now = 0;
  let closed = 0;
  const writes = [];
  return { io: { open: () => 7, write: (fd, buffer) => { writes.push(Buffer.from(buffer)); return write(fd, buffer, writes.length); },
    close: () => { closed++; }, now: () => now, pause: async ms => { now += ms; } },
    writes, closed: () => closed, elapsed: () => now };
}

test("terminal writes one frame and closes its descriptor", async () => {
  const mock = mockIO((_fd, b) => b.length);
  assert.equal(await writeFrame(Buffer.from("frame"), mock.io), true);
  assert.equal(mock.writes.length, 1);
  assert.equal(mock.closed(), 1);
});

test("EAGAIN before writing is retried within 150ms", async () => {
  const mock = mockIO((_fd, b, call) => { if (call < 3) throw Object.assign(new Error(), { code: "EAGAIN" }); return b.length; });
  assert.equal(await writeFrame(Buffer.from("frame"), mock.io), true);
  assert.equal(mock.elapsed(), 10);
  assert.equal(mock.closed(), 1);
});

test("a permanently full terminal is bounded and fail-open", async () => {
  const mock = mockIO(() => { throw Object.assign(new Error(), { code: "EAGAIN" }); });
  assert.equal(await writeFrame(Buffer.from("frame"), mock.io), false);
  assert.equal(mock.elapsed(), 150);
  assert.equal(mock.closed(), 1);
});

test("a partial OSC is immediately cancelled, never resumed across a yield", async () => {
  const mock = mockIO((_fd, b, call) => call === 1 ? 2 : b.length);
  assert.equal(await writeFrame(Buffer.from("frame"), mock.io), false);
  assert.equal(mock.writes[1].toString(), "\x18");
  assert.equal(mock.elapsed(), 0);
  assert.equal(mock.closed(), 1);
});

test("unavailable terminal and write errors do not throw", async () => {
  const mock = mockIO(() => { throw Object.assign(new Error(), { code: "EIO" }); });
  assert.equal(await writeFrame(Buffer.from("frame"), mock.io), false);
  assert.equal(mock.closed(), 1);
  mock.io.open = () => { throw new Error("No controlling terminal"); };
  assert.equal(await writeFrame(Buffer.from("frame"), mock.io), false);
});

test("metadata is verified, mismatches and malformed files preserve only the native ID", () => {
  const root = mkdtempSync(join(tmpdir(), "pebrel-session-"));
  try {
    const file = join(root, "会话.jsonl");
    const ctx = { sessionManager: { getSessionId: () => "native", getSessionFile: () => file } };
    writeFileSync(file, JSON.stringify({ type: "session", id: "native" }) + "\nSECRET_BODY");
    assert.deepEqual(sessionFor(ctx), { session_id: "native", session_file: file });
    writeFileSync(file, JSON.stringify({ type: "session", id: "different" }) + "\n");
    assert.deepEqual(sessionFor(ctx), { session_id: "native" });
    writeFileSync(file, "not-json\n");
    assert.deepEqual(sessionFor(ctx), { session_id: "native" });
    rmSync(file);
    assert.deepEqual(sessionFor(ctx), { session_id: "native" });
    assert.deepEqual(sessionFor(), {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("non-regular session metadata is ignored without losing the native ID", () => {
  const root = mkdtempSync(join(tmpdir(), "pebrel-session-directory-"));
  try {
    const file = join(root, "not-a-file.jsonl");
    mkdirSync(file);
    const ctx = { sessionManager: { getSessionId: () => "native", getSessionFile: () => file } };
    assert.deepEqual(sessionFor(ctx), { session_id: "native" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
