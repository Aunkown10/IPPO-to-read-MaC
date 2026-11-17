import type { Book, Direction, Progress, Shelf } from "../types.ts";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const clamp = (n: number, min: number, max: number): number => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
export const seriesKey = (s: string): string => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export function orderChapters(books: readonly Book[]): Book[] {
  const category = (b: Book) => b.volume !== null ? 0 : b.chapter !== null ? 1 : 2;
  return [...books].sort((a, b) => category(a) - category(b)
    || (a.volume ?? 0) - (b.volume ?? 0)
    || (a.chapter ?? 0) - (b.chapter ?? 0)
    || collator.compare(a.title, b.title)
    || a.addedAt - b.addedAt || a.id.localeCompare(b.id));
}
export function isBookCompleted(book: Book): boolean {
  return !!book.lastRead && progressPercent(book.progress, book.pages.length, true) >= 100;
}

export function buildShelves(books: readonly Book[]): Shelf[] {
  const groups = new Map<string, Book[]>();
  for (const book of books) {
    const key = seriesKey(book.series);
    groups.set(key, [...(groups.get(key) ?? []), book]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const sorted = orderChapters(members);
    const unfinished = members.filter((book) => !isBookCompleted(book));
    const recentUnfinished = [...unfinished].sort((a, b) => b.lastRead - a.lastRead)[0];
    const firstUnfinished = sorted.find((book) => !isBookCompleted(book));
    const recentAny = [...members].sort((a, b) => b.lastRead - a.lastRead)[0];
    const resume = recentUnfinished?.lastRead ? recentUnfinished : firstUnfinished ?? recentAny ?? sorted[0];
    return { key, title: sorted[0].series, books: sorted, resume, lastRead: recentUnfinished?.lastRead ?? 0 };
  }).sort((a, b) => collator.compare(a.title, b.title));
}
export function progressPercent(progress: Progress, total: number, started = true): number {
  if (!started || total < 1) return 0;
  const part = progress.mode === "paged" ? 1 : clamp(progress.offset, 0, 1);
  return clamp(((clamp(progress.page, 0, total - 1) + part) / total) * 100, 0, 100);
}
export function pageDelta(key: string, direction: Direction): number {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return 0;
  return (key === "ArrowRight" ? 1 : -1) * (direction === "rtl" ? -1 : 1);
}
export function pageTurnSide(from: number, to: number, direction: Direction): "left" | "right" {
  const pageStep = to > from ? 1 : -1;
  const visualStep = direction === "rtl" ? -pageStep : pageStep;
  return visualStep > 0 ? "left" : "right";
}
export function relativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return "Not started";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (!!target.closest("input, textarea, select") || target.isContentEditable);
}
export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

type Step = 1 | -1;
export interface Clock { set(callback: () => void, delay: number): unknown; clear(handle: unknown): void }
const clock: Clock = {
  set: (callback, delay) => globalThis.setTimeout(callback, delay),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Delay a single Space so double Space never advances a page before changing chapters. */
export class SpaceTap {
  private timer: unknown | undefined;
  private pending: Step | undefined;
  private single: (direction: Step) => void;
  private double: (direction: Step) => void;
  private clock: Clock;
  private delay: number;
  constructor(single: (direction: Step) => void, double: (direction: Step) => void, delay = 280, scheduler = clock) {
    this.single = single; this.double = double; this.delay = delay; this.clock = scheduler;
  }
  press(direction: Step): void {
    if (this.timer !== undefined && this.pending === direction) {
      this.cancel(); this.double(direction); return;
    }
    if (this.timer !== undefined) {
      const old = this.pending!; this.cancel(); this.single(old);
    }
    this.pending = direction;
    this.timer = this.clock.set(() => {
      this.timer = undefined; this.pending = undefined; this.single(direction);
    }, this.delay);
  }
  cancel(): void {
    if (this.timer !== undefined) this.clock.clear(this.timer);
    this.timer = undefined; this.pending = undefined;
  }
}

/** Serialize writes, coalesce rapid updates, retain the newest update on failure. */
export class SaveQueue<T> {
  private write: (value: T) => Promise<void>;
  private onError: (error: unknown) => void;
  private pending: T | undefined;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  constructor(write: (value: T) => Promise<void>, onError: (error: unknown) => void = () => {}) {
    this.write = write; this.onError = onError;
  }
  schedule(value: T, delay = 180): void {
    if (this.disposed) return;
    this.pending = value;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error) => { if (!this.disposed) this.onError(error); });
    }, delay);
  }
  async flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed) return;
    if (this.running) {
      await this.running;
      if (this.pending !== undefined) await this.flush();
      return;
    }
    this.running = (async () => {
      while (this.pending !== undefined && !this.disposed) {
        const value = this.pending; this.pending = undefined;
        try { await this.write(value); }
        catch (error) { if (this.pending === undefined && !this.disposed) this.pending = value; throw error; }
      }
    })();
    try { await this.running; } finally { this.running = null; }
  }
  dispose(): void {
    this.disposed = true; this.pending = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
