import { EventEmitter } from "node:events";
import type { JobEvent } from "@studio/shared";

/** In-process pub/sub for job progress events consumed by SSE routes. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publishJobEvent(jobId: string, event: JobEvent): void {
  bus.emit(`job:${jobId}`, event);
}

export function subscribeJob(jobId: string, listener: (event: JobEvent) => void): () => void {
  const channel = `job:${jobId}`;
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}
