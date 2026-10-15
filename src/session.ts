import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SessionContext = Pick<ExtensionContext, "cwd" | "sessionManager">;

export function sessionFor(ctx: SessionContext): { session_id?: string; session_file?: string } {
  let direct: string | undefined = ctx.sessionManager.getSessionId();
  const file = ctx.sessionManager.getSessionFile();
  if (!direct || direct.length > 512) direct = undefined;
  let fd: number | undefined;
  try {
    if (file && file.length <= 4096 && file.endsWith(".jsonl")) {
      // Nonblocking open plus a regular-file check also avoids hanging on a FIFO.
      fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
      if (!fstatSync(fd).isFile()) return direct ? { session_id: direct } : {};
      const buffer = Buffer.alloc(16384);
      const length = readSync(fd, buffer, 0, buffer.length, 0);
      const end = buffer.subarray(0, length).indexOf(10);
      if (end >= 0) {
        const header = JSON.parse(buffer.subarray(0, end).toString("utf8"));
        if (header.type === "session" && typeof header.id === "string" && header.id
            && header.id.length <= 512 && (!direct || direct === header.id)) {
          return { session_id: header.id, session_file: file };
        }
      }
    }
  } catch {} finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
  return direct ? { session_id: direct } : {};
}
