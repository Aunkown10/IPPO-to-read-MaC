import test from "node:test";
import assert from "node:assert/strict";
import { buildShelves, clamp, isBookCompleted, orderChapters, pageDelta, pageTurnSide, progressPercent, relativeTime, SaveQueue, seriesKey, SpaceTap } from "../src/lib/logic.ts";
import type { Clock } from "../src/lib/logic.ts";
import { EMPTY_METADATA } from "../src/types.ts";
import type { Book, Progress } from "../src/types.ts";
const progress: Progress = { page: 0, offset: 0, mode: "paged", direction: "ltr", zoom: 1 };
const book = (id: string, patch: Partial<Book> = {}): Book => ({
  id, title: `Volume ${id}`, series: "Paper Cities", volume: Number(id), chapter: null,
  kind: "images", format: "CBZ", pages: [{ width: 1, height: 1, mime: "image/png" }],
  metadata: { ...EMPTY_METADATA }, readingSeconds: 0, wordCount: 0,
  hasCover: true, progress: { ...progress }, lastRead: 0, addedAt: 1, isPrivate: false, ...patch,
});

test("clamp handles normal values, boundaries and non-finite values", () => {
  assert.equal(clamp(3, 0, 10), 3); assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10); assert.equal(clamp(NaN, 0, 10), 0);
});
test("shelf names normalize whitespace and case", () => {
  assert.equal(seriesKey("  Paper   Cities "), seriesKey("paper cities"));
  assert.equal(seriesKey("\uff30\uff41\uff50\uff45\uff52 Cities"), seriesKey("Paper Cities"));
});
test("volume ordering is numeric, not alphabetical", () => {
  assert.deepEqual(orderChapters([book("10"), book("2"), book("1")]).map((b) => b.id), ["1", "2", "10"]);
});
test("chapter ordering preserves decimal chapters", () => {
  const result = orderChapters([book("3", { volume: null, chapter: 10.5 }), book("2", { volume: null, chapter: 10 }), book("1", { volume: null, chapter: 9 })]);
  assert.deepEqual(result.map((b) => b.chapter), [9, 10, 10.5]);
});
test("volumes come before loose chapters within a mixed shelf", () => {
  const result = orderChapters([book("chapter", { volume: null, chapter: 1 }), book("1")]);
  assert.equal(result[0].id, "1");
});
test("sort does not mutate the input array", () => {
  const original = [book("10"), book("2")]; orderChapters(original); assert.equal(original[0].id, "10");
});
test("common-name books share a shelf and unrelated series do not", () => {
  const shelves = buildShelves([book("1"), book("2", { series: "paper cities" }), book("3", { series: "A Different Story" })]);
  assert.equal(shelves.length, 2); assert.equal(shelves.find((s) => s.key === "paper cities")?.books.length, 2);
});
test("resume chooses the most recently read comic, not the largest chapter number", () => {
  const shelf = buildShelves([book("1", { lastRead: 1000 }), book("9", { lastRead: 500 })])[0];
  assert.equal(shelf.resume.id, "1");
});
test("unread shelves begin at their first numbered volume", () => {
  assert.equal(buildShelves([book("10"), book("2"), book("1")])[0].resume.id, "1");
});
test("completed comics are recognized from their saved 100 percent bookmark", () => {
  assert.equal(isBookCompleted(book("1", { lastRead: 1000, progress: { ...progress, page: 0 } })), true);
  assert.equal(isBookCompleted(book("2", { lastRead: 1000, pages: [{ width: 1, height: 1, mime: "image/png" }, { width: 1, height: 1, mime: "image/png" }], progress: { ...progress, page: 0 } })), false);
  assert.equal(isBookCompleted(book("3", { lastRead: 0, progress: { ...progress, page: 0 } })), false);
});
test("shelf resume skips completed comics and picks the newest unfinished comic", () => {
  const pages = [{ width: 1, height: 1, mime: "image/png" }, { width: 1, height: 1, mime: "image/png" }];
  const completed = book("1", { pages, lastRead: 3000, progress: { ...progress, page: 1 } });
  const unfinished = book("2", { pages, lastRead: 2000, progress: { ...progress, page: 0 } });
  const shelf = buildShelves([completed, unfinished])[0];
  assert.equal(shelf.resume.id, "2");
  assert.equal(shelf.lastRead, 2000);
});
test("paged progress counts the visible page", () => {
  assert.equal(progressPercent(progress, 10), 10);
  assert.equal(progressPercent({ ...progress, page: 9 }, 10), 100);
});
test("scroll progress retains a fractional position inside the current page", () => {
  assert.equal(progressPercent({ ...progress, page: 3, offset: .5, mode: "scroll" }, 10), 35);
  assert.equal(progressPercent({ ...progress, page: 9, offset: 1, mode: "scroll" }, 10), 100);
});
test("unread and zero-page comics report zero percent", () => {
  assert.equal(progressPercent(progress, 0), 0); assert.equal(progressPercent(progress, 10, false), 0);
});
test("out-of-range progress cannot exceed 100 percent", () => {
  assert.equal(progressPercent({ ...progress, page: 1000 }, 10), 100);
  assert.equal(progressPercent({ ...progress, page: -100, mode: "scroll", offset: -1 }, 10), 0);
});
test("left and right arrow semantics reverse in RTL, but non-arrow keys do not", () => {
  assert.equal(pageDelta("ArrowRight", "ltr"), 1); assert.equal(pageDelta("ArrowLeft", "ltr"), -1);
  assert.equal(pageDelta("ArrowRight", "rtl"), -1); assert.equal(pageDelta("ArrowLeft", "rtl"), 1);
  assert.equal(pageDelta("Space", "rtl"), 0);
});

test("page flip turns match LTR and RTL reading direction", () => {
  assert.equal(pageTurnSide(0, 1, "ltr"), "left");
  assert.equal(pageTurnSide(1, 0, "ltr"), "right");
  assert.equal(pageTurnSide(0, 1, "rtl"), "right");
  assert.equal(pageTurnSide(1, 0, "rtl"), "left");
});

test("relative time is stable at minute and day boundaries", () => {
  assert.equal(relativeTime(0, 1000), "Not started"); assert.equal(relativeTime(1000, 2000), "Just now");
  assert.equal(relativeTime(1, 120001), "2m ago"); assert.equal(relativeTime(1, 86400001), "1d ago");
});

class FakeClock implements Clock {
  now = 0; id = 0; jobs = new Map<number, { at: number; callback: () => void }>();
  set(callback: () => void, delay: number): number { const id = ++this.id; this.jobs.set(id, { at: this.now + delay, callback }); return id; }
  clear(handle: unknown): void { this.jobs.delete(handle as number); }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, job] of [...this.jobs]) if (job.at <= this.now) { this.jobs.delete(id); job.callback(); }
  }
}
test("single Space advances once, only after the detection window", () => {
  const c = new FakeClock(); const calls: string[] = [];
  const tap = new SpaceTap((d) => calls.push(`single:${d}`), (d) => calls.push(`double:${d}`), 280, c);
  tap.press(1); c.advance(279); assert.deepEqual(calls, []); c.advance(1); assert.deepEqual(calls, ["single:1"]);
});
test("double Space changes chapter without an unwanted single-page advance", () => {
  const c = new FakeClock(); const calls: string[] = [];
  const tap = new SpaceTap((d) => calls.push(`single:${d}`), (d) => calls.push(`double:${d}`), 280, c);
  tap.press(1); c.advance(150); tap.press(1); c.advance(1000); assert.deepEqual(calls, ["double:1"]);
});
test("double Shift+Space goes to the previous chapter", () => {
  const c = new FakeClock(); const calls: number[] = [];
  const tap = new SpaceTap(() => assert.fail("single action should be cancelled"), (d) => calls.push(d), 280, c);
  tap.press(-1); tap.press(-1); c.advance(1000); assert.deepEqual(calls, [-1]);
});
test("separate taps outside the time window remain separate page turns", () => {
  const c = new FakeClock(); const calls: number[] = [];
  const tap = new SpaceTap((d) => calls.push(d), () => assert.fail("not a double tap"), 280, c);
  tap.press(1); c.advance(300); tap.press(1); c.advance(300); assert.deepEqual(calls, [1, 1]);
});
test("mixing Space and Shift+Space does not trigger a chapter change", () => {
  const c = new FakeClock(); const calls: number[] = [];
  const tap = new SpaceTap((d) => calls.push(d), () => assert.fail("not a double tap"), 280, c);
  tap.press(1); tap.press(-1); c.advance(300); assert.deepEqual(calls, [1, -1]);
});
test("leaving the reader cancels a pending Space action", () => {
  const c = new FakeClock();
  const tap = new SpaceTap(() => assert.fail("cancelled"), () => assert.fail("cancelled"), 280, c);
  tap.press(1); tap.cancel(); c.advance(1000); assert.equal(c.jobs.size, 0);
});

test("bookmark writes coalesce to the newest value", async () => {
  const values: number[] = []; const queue = new SaveQueue<number>(async (value) => { values.push(value); });
  queue.schedule(1, 10000); queue.schedule(2, 10000); await queue.flush(); queue.dispose(); assert.deepEqual(values, [2]);
});
test("in-flight bookmark writes cannot overwrite newer bookmarks out of order", async () => {
  const values: number[] = []; let release!: () => void; let active = 0; let maxActive = 0;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const queue = new SaveQueue<number>(async (value) => { active++; maxActive = Math.max(active, maxActive); values.push(value); if (value === 1) await first; active--; });
  queue.schedule(1, 10000); const flushing = queue.flush(); queue.schedule(2, 10000); queue.schedule(3, 10000);
  release(); await flushing; queue.dispose(); assert.deepEqual(values, [1, 3]); assert.equal(maxActive, 1);
});
test("a failed save is retained for retry", async () => {
  let attempts = 0; const values: number[] = [];
  const queue = new SaveQueue<number>(async (value) => { if (++attempts === 1) throw new Error("disk full"); values.push(value); });
  queue.schedule(7, 10000); await assert.rejects(queue.flush(), /disk full/); await queue.flush(); queue.dispose(); assert.deepEqual(values, [7]);
});
test("after an in-flight failure the newest pending bookmark wins", async () => {
  let reject!: (reason: Error) => void; const block = new Promise<void>((_, fail) => { reject = fail; }); const values: number[] = [];
  const queue = new SaveQueue<number>(async (value) => { if (value === 1) await block; values.push(value); });
  queue.schedule(1, 10000); const attempt = queue.flush(); queue.schedule(2, 10000); reject(new Error("temporary failure"));
  await assert.rejects(attempt, /temporary/); await queue.flush(); queue.dispose(); assert.deepEqual(values, [2]);
});
test("simultaneous flush requests share a serialized write", async () => {
  let count = 0; const queue = new SaveQueue<number>(async () => { count++; await Promise.resolve(); });
  queue.schedule(1, 10000); await Promise.all([queue.flush(), queue.flush(), queue.flush()]); queue.dispose(); assert.equal(count, 1);
});
test("disposing the reader cancels unsent work and ignores later schedules", async () => {
  const queue = new SaveQueue<number>(async () => assert.fail("disposed queue must not write"));
  queue.schedule(1, 10000); queue.dispose(); queue.schedule(2, 10000); await queue.flush();
});
