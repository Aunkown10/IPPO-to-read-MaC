import type { Progress } from "../types";
import { SaveQueue } from "./logic";
const queues = new Set<SaveQueue<Progress>>();
export function trackQueue(queue: SaveQueue<Progress>): () => void {
  queues.add(queue); return () => { queues.delete(queue); queue.dispose(); };
}
export async function flushAllProgress(): Promise<void> {
  await Promise.all([...queues].map((queue) => queue.flush()));
}
