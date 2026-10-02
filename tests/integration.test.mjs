import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "pi.js");
const root = resolve(process.env.TEST_PACKAGE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const cli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
let sdk = dirname(cli);
while (!existsSync(join(sdk, "package.json")) || JSON.parse(readFileSync(join(sdk, "package.json"))).name !== "@earendil-works/pi-coding-agent") {
  const parent = dirname(sdk);
  if (parent === sdk) throw new Error("Installed Pi SDK not found");
  sdk = parent;
}
const token = "a".repeat(32); // A dummy test token, never a user's real pane token.
const framePattern = /\x1b\]777;nebula-hook;([a-fA-F0-9]{32});([A-Za-z0-9+/=]+)\x07/g;

function isolated(changes = {}) {
  const home = mkdtempSync(join(tmpdir(), "pebrel-package-test-"));
  const agent = join(home, "agent");
  mkdirSync(agent);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(PEBREL_|NEBULA_|PI_|OPENAI_|ANTHROPIC_)/.test(key)) delete env[key];
  Object.assign(env, { HOME: home, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), npm_config_cache: join(home, "npm-cache"),
    npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", TEST_PI_SDK: sdk, TEST_PACKAGE_ROOT: root,
    TERM_PROGRAM: "pebrel", WSL_DISTRO_NAME: "test", PEBREL_PANE_ID: "999", PEBREL_REMOTE_HOOK_TOKEN: token,
    PEBREL_HOOK_EXE: "/mnt/c/bogus-windows-helper.exe", ...changes });
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ enableInstallTelemetry: false, enableAnalytics: false }));
  return { home, agent, env, clean: () => rmSync(home, { recursive: true, force: true }) };
}

function install(context) {
  execFileSync(process.execPath, [cli, "install", root], { env: context.env, cwd: context.home, timeout: 15000, stdio: "pipe" });
}

function run(scenario = "success", changes = {}, extraExtension = false) {
  const context = isolated(changes);
  try {
    install(context);
    if (extraExtension) {
      mkdirSync(join(context.agent, "extensions"));
      writeFileSync(join(context.agent, "extensions/another.ts"), "export default function () {}\n");
    }
    const command = [process.execPath, fixture, scenario]
      .map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" ");
    const result = spawnSync("script", ["-q", "-e", "-c", command, "/dev/null"], {
      env: context.env, cwd: context.home, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ""));
    assert.match(result.stdout, /"test":"finished"/);
    assert.doesNotMatch(result.stdout, /SECRET_PROVIDER_ERROR|SECRET_ANSWER/);
    const events = [...result.stdout.matchAll(framePattern)].map(match => {
      assert.equal(match[1], token);
      const [header, raw] = Buffer.from(match[2], "base64").toString("utf8").split("\n");
      assert.match(header, /^nebula-hook\/1 source=pi process=\d+:\d+$/);
      return { header, ...JSON.parse(raw) };
    });
    assert.equal(existsSync(join(context.home, ".local/share/pebrel-wsl-pi")), false, "No external helper installation");
    assert.equal(existsSync(join(context.home, ".cache/pebrel/hooks")), false, "No Python-style stream cache");
    if (extraExtension) assert.equal(readFileSync(join(context.agent, "extensions/another.ts"), "utf8"), "export default function () {}\n");
    return events;
  } finally { context.clean(); }
}

test("real pi install/list/remove uses only a package setting, preserving unrelated settings", () => {
  const context = isolated();
  try {
    const settings = join(context.agent, "settings.json");
    const before = { enableInstallTelemetry: false, enableAnalytics: false, defaultThinkingLevel: "high" };
    writeFileSync(settings, JSON.stringify(before));
    install(context);
    install(context);
    const value = JSON.parse(readFileSync(settings));
    const { packages, ...unrelated } = value;
    assert.deepEqual(unrelated, before);
    assert.equal(packages.length, 1);
    assert.equal(resolve(context.agent, packages[0]), root);
    const output = execFileSync(process.execPath, [cli, "list"], { env: context.env, cwd: context.home, encoding: "utf8", timeout: 15000 });
    assert.ok(output.includes(root) || output.includes(packages[0]), output);
    execFileSync(process.execPath, [cli, "remove", root], { env: context.env, cwd: context.home, timeout: 15000, stdio: "pipe" });
    const after = JSON.parse(readFileSync(settings));
    assert.equal(after.defaultThinkingLevel, before.defaultThinkingLevel);
    assert.deepEqual(after.packages ?? [], []);
    assert.equal(existsSync(join(context.agent, "extensions/pebrel-wsl.ts")), false);
  } finally { context.clean(); }
});

test("fresh real Pi startup loads the installed package and exits cleanly without Python", () => {
  const context = isolated();
  try {
    install(context);
    const command = [process.execPath, cli, "--mode", "rpc", "--no-session"]
      .map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" ");
    const result = spawnSync("script", ["-q", "-e", "-c", command, "/dev/null"], {
      env: context.env, cwd: context.home, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024,
      input: '{"id":"inspect","type":"get_state"}\n\x04',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ""));
    const matches = [...result.stdout.matchAll(framePattern)];
    const events = matches.map(match => {
      assert.equal(match[1], token);
      const [header, raw] = Buffer.from(match[2], "base64").toString("utf8").split("\n");
      assert.match(header, /^nebula-hook\/1 source=pi process=\d+:\d+$/);
      return JSON.parse(raw);
    });
    assert.deepEqual(events.map(event => event.kind), ["session-start", "session-end"]);
    const response = result.stdout.replace(framePattern, "").split(/\r?\n/)
      .filter(line => line.startsWith("{"))
      .map(line => { try { return JSON.parse(line); } catch { return undefined; } })
      .find(record => record?.type === "response" && record.id === "inspect");
    assert.equal(response?.success, true, result.stdout);
    assert.equal(events[0].session_id, response.data.sessionId);
    assert.equal(events[1].session_id, events[0].session_id);
    assert.equal(existsSync(join(context.home, ".local/share/pebrel-wsl-pi")), false);
  } finally { context.clean(); }
});

test("installed package auto-discovers, delivers ordered real-PTY events and deduplicates settled", () => {
  const events = run();
  assert.deepEqual(events.map(e => e.kind), ["session-start", "prompt", "tool-complete", "done", "session-end"]);
  for (const event of events) {
    assert.equal(event.session_id, "57bbced3-ea1c-4f52-bcd1-e8e870c2f580");
    assert.ok(event.session_file.endsWith("/native-session.jsonl"));
    assert.ok(Number.isSafeInteger(event.bridge_sequence), "Remote wire sequence must be an exact JSON integer");
  }
  assert.equal(events[3].stop_reason, "stop");
  for (let i = 1; i < events.length; i++) assert.equal(BigInt(events[i].bridge_sequence), BigInt(events[i - 1].bridge_sequence) + 1n);
  assert.equal(new Set(events.map(e => e.event_id)).size, events.length);
});

test("retry waits for settled instead of announcing the first agent_end", () => {
  const events = run("retry");
  assert.deepEqual(events.map(e => e.kind), ["session-start", "prompt", "prompt", "tool-complete", "done", "session-end"]);
  assert.equal(events[4].stop_reason, "stop");
});

test("error, abort, truncation and tool-use outcomes are preserved", () => {
  for (const reason of ["error", "aborted", "length", "toolUse"]) {
    const events = run(reason);
    const done = events.filter(e => e.kind === "done");
    assert.equal(done.length, 1);
    assert.equal(done[0].stop_reason, reason);
  }
});

test("concurrent tool events stay ordered before completion", () => {
  assert.deepEqual(run("concurrent").map(e => e.kind), ["session-start", "prompt", "tool-complete", "tool-complete", "tool-complete", "done", "session-end"]);
});

test("invalid scopes do nothing, and inherited Windows helpers are never executed", () => {
  for (const change of [{ TERM_PROGRAM: "other" }, { WSL_DISTRO_NAME: "" }, { PEBREL_PANE_ID: "bad" }, { PEBREL_REMOTE_HOOK_TOKEN: "bad" }]) {
    assert.deepEqual(run("success", change), []);
  }
});

test("without a session file the authoritative native ID is still sent", () => {
  for (const event of run("no-file")) {
    assert.ok(event.session_id);
    assert.equal(event.session_file, undefined);
  }
});

test("mismatched file identity never replaces the native ID", () => {
  for (const event of run("mismatch").slice(1)) {
    assert.equal(event.session_id, "954df806-7a41-441d-af3c-d2fddac35120");
    assert.equal(event.session_file, undefined);
  }
});

test("shutdown followed by reload reacquires ownership and starts a new stream", () => {
  const events = run("reload");
  assert.deepEqual(events.map(e => e.kind), ["session-start", "prompt", "tool-complete", "done", "session-end", "session-start", "prompt", "done", "session-end"]);
  assert.notEqual(events[0].bridge_instance, events[5].bridge_instance);
  assert.ok(events[5].bridge_sequence > events[4].bridge_sequence, "Sequence must survive reload within the same PID epoch");
});

test("duplicate package factories cannot report the same lifecycle twice", () => {
  assert.deepEqual(run("duplicate").map(e => e.kind), ["session-start", "prompt", "tool-complete", "done", "session-end"]);
});

test("other Pi extensions do not disable this package and are left unchanged", () => {
  assert.deepEqual(run("success", {}, true).map(e => e.kind), ["session-start", "prompt", "tool-complete", "done", "session-end"]);
});
