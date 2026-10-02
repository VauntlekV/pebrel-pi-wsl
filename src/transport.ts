import { closeSync, constants, openSync, readFileSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";

export interface Scope { token: string }

export function resolveScope(env: NodeJS.ProcessEnv = process.env, platform = process.platform): Scope | undefined {
  const token = env.PEBREL_REMOTE_HOOK_TOKEN ?? env.NEBULA_REMOTE_HOOK_TOKEN;
  const pane = env.PEBREL_PANE_ID ?? env.NEBULA_PANE_ID;
  if (platform !== "linux" || !env.WSL_DISTRO_NAME
      || !["pebrel", "nebula"].includes(env.TERM_PROGRAM ?? "")
      || !pane || !/^\d+$/.test(pane) || !token || !/^[a-fA-F0-9]{32}$/.test(token)) return;
  return { token };
}

export function processIdentity(stat = readFileSync("/proc/self/stat", "utf8"), pid = process.pid): string {
  const end = stat.lastIndexOf(")");
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  const start = fields[19]; // Linux /proc stat field 22, after pid and comm.
  if (end < 0 || !/^\d+$/.test(start ?? "")) throw new Error("Invalid Linux process identity");
  return `${pid}:${start}`;
}

export function encodeFrame(scope: Scope, identity: string, payload: object): Buffer {
  if (!/^[a-fA-F0-9]{32}$/.test(scope.token) || !/^\d+:\d+$/.test(identity)) {
    throw new Error("Invalid hook scope or process identity");
  }
  const envelope = Buffer.from(`nebula-hook/1 source=pi process=${identity}\n${JSON.stringify(payload)}`, "utf8");
  if (envelope.length > 64 * 1024) throw new Error("Hook envelope exceeds protocol limit");
  return Buffer.from(`\x1b]777;nebula-hook;${scope.token};${envelope.toString("base64")}\x07`, "ascii");
}

export interface TerminalIO {
  open: () => number;
  write: (fd: number, data: Buffer) => number;
  close: (fd: number) => void;
  now: () => number;
  pause: (ms: number) => Promise<unknown>;
}

const terminal: TerminalIO = {
  open: () => openSync("/dev/tty", constants.O_WRONLY | constants.O_NONBLOCK),
  write: (fd, data) => writeSync(fd, data),
  close: closeSync,
  now: () => performance.now(),
  pause,
};

export async function writeFrame(frame: Buffer, io: TerminalIO = terminal): Promise<boolean> {
  let fd: number | undefined;
  const deadline = io.now() + 150;
  try {
    fd = io.open();
    while (io.now() < deadline) {
      let written: number;
      try { written = io.write(fd, frame); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EAGAIN" && code !== "EWOULDBLOCK" && code !== "EINTR") return false;
        await io.pause(5);
        continue;
      }
      if (written === frame.length) return true;
      if (written > 0) {
        // Do not yield with a partial OSC: ordinary TUI output could enter it.
        // Cancel immediately rather than risking corruption by resuming later.
        try { io.write(fd, Buffer.from("\x18")); } catch {}
        return false;
      }
      await io.pause(5);
    }
  } catch {} finally { if (fd !== undefined) try { io.close(fd); } catch {} }
  return false;
}
