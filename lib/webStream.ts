import type { Readable } from "node:stream";

/**
 * Bridges a Node Readable to a Web ReadableStream ourselves rather than using Node's built-in
 * `Readable.toWeb()`. When the underlying stream is a killed child process's stdout, the process
 * death (from an AbortSignal-triggered SIGKILL on re-seek) and the client-cancel-triggered
 * destroy() race each other, and `Readable.toWeb()`'s internal bridge isn't guarded against being
 * asked to close/error its controller twice — it throws `ERR_INVALID_STATE: Controller is already
 * closed` as an uncaught exception. This wrapper tracks "already finished" itself so at most one
 * terminal controller call ever happens. Used by any route that streams a live ffmpeg process.
 */
export function toWebStream(node: Readable): ReadableStream<Uint8Array> {
  let finished = false;
  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk) => {
        if (finished) return;
        try {
          controller.enqueue(chunk);
        } catch {
          // controller already closed/errored elsewhere — ignore
        }
      });
      node.on("end", () => {
        if (finished) return;
        finished = true;
        try {
          controller.close();
        } catch {}
      });
      node.on("close", () => {
        if (finished) return;
        finished = true;
        try {
          controller.close();
        } catch {}
      });
      node.on("error", (err) => {
        if (finished) return;
        finished = true;
        try {
          controller.error(err);
        } catch {}
      });
    },
    cancel() {
      finished = true;
      node.destroy();
    },
  });
}
