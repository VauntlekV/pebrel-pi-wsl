// Adapted from Kuddev/pebrel v2.1.1 res/hooks/pi.ts. See NOTICE and LICENSE.
import { randomUUID } from "node:crypto";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionFor, type SessionContext } from "./src/session.ts";
import { encodeFrame, processIdentity, resolveScope, writeFrame } from "./src/transport.ts";

type Kind = "session-start" | "prompt" | "tool-complete" | "done" | "session-end";
type Registry = { owner?: string; sequence?: number };
const ownerKey = Symbol.for("pebrel-pi-wsl.active-instance");

export default function (pi: ExtensionAPI) {
  const globals = globalThis as typeof globalThis & { [ownerKey]?: Registry };
  const registry = globals[ownerKey] ??= {};
  const instance = randomUUID();
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(VERSION);
  const supported = !!match && (Number(match[1]) > 0 || Number(match[2]) > 80
    || (Number(match[2]) === 80 && Number(match[3]) >= 4));
  let active = false;
  let reason = "unknown";
  let delivery = Promise.resolve();

  function send(kind: Kind, ctx?: SessionContext, stopReason?: string): Promise<void> {
    const scope = resolveScope();
    if (!scope || !supported || registry.owner !== instance) return Promise.resolve();
    try {
      // Match the remote protocol's integer sequence, without losing precision.
      // Keep it across reloads in this process; a new PID epoch is a new stream.
      const bridge_sequence = registry.sequence = (registry.sequence ?? Date.now() * 1000) + 1;
      if (!Number.isSafeInteger(bridge_sequence)) return Promise.resolve();
      const payload = {
        kind,
        ...sessionFor(ctx),
        bridge_instance: instance,
        bridge_sequence,
        event_id: `${instance}:${bridge_sequence}`,
        cwd: typeof ctx?.cwd === "string" ? ctx.cwd.slice(0, 4096) : "",
        ...(stopReason === undefined ? {} : { stop_reason: stopReason }),
      };
      const frame = encodeFrame(scope, processIdentity(), payload);
      delivery = delivery.then(async () => { await writeFrame(frame); }).catch(() => {});
      return delivery;
    } catch { return Promise.resolve(); }
  }

  pi.on("session_start", async (_event, ctx) => {
    active = false;
    reason = "unknown";
    if (!resolveScope()) return;
    if (!supported) {
      if (ctx.hasUI) ctx.ui.notify(`pebrel-pi-wsl 未启用：Pi ${VERSION} 不支持 agent_settled。`, "warning");
      return;
    }
    if (registry.owner && registry.owner !== instance) return;
    registry.owner = instance;
    await send("session-start", ctx);
  });
  pi.on("agent_start", async (_event, ctx) => {
    active = true;
    reason = "unknown";
    await send("prompt", ctx);
  });
  pi.on("agent_end", async (event) => {
    if (!active) return;
    const last = [...event.messages].reverse().find(message => message.role === "assistant");
    reason = last?.role === "assistant" ? last.stopReason ?? "unknown" : "unknown";
  });
  pi.on("agent_settled", async (_event, ctx) => {
    if (!active) return;
    active = false;
    await send("done", ctx, reason);
  });
  pi.on("tool_result", async (_event, ctx) => { await send("tool-complete", ctx); });
  pi.on("session_shutdown", async (_event, ctx) => {
    active = false;
    try { await send("session-end", ctx); }
    finally { if (registry.owner === instance) delete registry.owner; }
  });
}
