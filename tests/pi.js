// Real Pi resource discovery and loader; mock events, no model or user credentials.
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sdk = await import(pathToFileURL(join(process.env.TEST_PI_SDK, "dist/index.js")).href);
const scenario = process.argv[2] ?? "success";
const makeLoader = async () => {
  const loader = new sdk.DefaultResourceLoader({ cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR });
  await loader.reload();
  const result = loader.getExtensions();
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  const expected = join(process.env.TEST_PACKAGE_ROOT, "index.ts");
  const own = result.extensions.filter(extension => extension.path === expected);
  assert.equal(own.length, 1, JSON.stringify(result.extensions.map(extension => extension.path)));
  return own[0];
};
const extensions = [await makeLoader()];
if (scenario === "duplicate") extensions.push(await makeLoader());
const id = "57bbced3-ea1c-4f52-bcd1-e8e870c2f580";
const file = join(process.env.HOME, "native-session.jsonl");
const manager = scenario === "materialize" ? sdk.SessionManager.create(process.cwd(), join(process.env.HOME, "sessions")) : undefined;
if (manager) assert.equal(existsSync(manager.getSessionFile()), false);
else writeFileSync(file, JSON.stringify({ type: "session", version: 3, id }) + "\n");
let currentId = id;
const ctx = { cwd: process.cwd(), hasUI: false, sessionManager: manager ?? {
  getSessionId: () => currentId,
  getSessionFile: () => scenario === "no-file" ? undefined : file,
} };
const emit = async (name, event = {}) => {
  for (const extension of extensions) {
    for (const handler of extension.handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  }
};
const end = reason => emit("agent_end", { messages: scenario === "no-assistant" ? [] : [
  { role: "assistant", stopReason: "error", content: [] },
  { role: "assistant", stopReason: reason, errorMessage: "SECRET_PROVIDER_ERROR", content: [{ type: "text", text: "SECRET_ANSWER" }] },
  { role: "user", content: "SECRET_ANSWER" },
] });
const beforeEnv = JSON.stringify(process.env);
await emit("session_start");
if (manager) {
  manager.appendMessage({ role: "user", content: "SECRET_QUESTION", timestamp: Date.now() });
  assert.equal(existsSync(manager.getSessionFile()), true);
}
if (scenario === "mismatch") currentId = "954df806-7a41-441d-af3c-d2fddac35120";
if (scenario.startsWith("waiting")) await emit("ui_prompt_start");
await emit("agent_start");
if (scenario === "retry") { await end("error"); await emit("agent_start"); }
if (scenario.startsWith("waiting")) {
  await emit("ui_prompt_start", { title: "SECRET_QUESTION" });
  await emit("ui_prompt_start");
  await Promise.all([emit("tool_result"), emit("tool_result")]);
  if (scenario === "waiting") { await emit("ui_prompt_end"); await emit("ui_prompt_end"); }
} else if (scenario === "concurrent") await Promise.all([emit("tool_result"), emit("tool_result"), emit("tool_result")]);
else await emit("tool_result");
await end(["error", "aborted", "length", "toolUse"].includes(scenario) ? scenario : "stop");
await emit("agent_settled");
await emit("agent_settled");
if (scenario.startsWith("waiting")) await emit("ui_prompt_end");
await emit("session_shutdown");
if (scenario === "reload") {
  extensions.splice(0, extensions.length, await makeLoader());
  await emit("session_start");
  await emit("agent_start");
  await end("stop");
  await emit("agent_settled");
  await emit("session_shutdown");
}
assert.equal(JSON.stringify(process.env), beforeEnv);
console.log(JSON.stringify({ test: "finished", scenario, pid: process.pid }));
