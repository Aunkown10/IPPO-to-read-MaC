import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Book, PageSize, Preferences, Progress } from "../types";
import { api } from "../lib/api";
import { clamp, errorText, isEditable, pageDelta, pageTurnSide, progressPercent, SaveQueue, SpaceTap } from "../lib/logic";
import { openPdf } from "../lib/pdf";
import { trackQueue } from "../lib/progress";
import { useReadingTime } from "../lib/readingTime";
import { Icon } from "./Icon";

interface PageProps {
  book: Book; index: number; size: PageSize; width: number; pdf: PDFDocumentProxy | null;
  viewport: RefObject<HTMLDivElement | null>; lazy: boolean; scrollMode: boolean; elementRef: (node: HTMLDivElement | null) => void;
}
function PageSurface({ book, index, size, width, pdf, viewport, lazy, scrollMode, elementRef }: PageProps) {
  const slot = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!lazy); const [url, setUrl] = useState<string>(); const [error, setError] = useState("");
  const [imageReady, setImageReady] = useState(false);
  useEffect(() => {
    if (!lazy) { setVisible(true); return; }
    // Keep a generous render window around the viewport. This avoids visible
    // pop-in during fast manhwa scrolling while still releasing far-away
    // image/PDF resources on very long chapters.
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: viewport.current, rootMargin: "1800px 0px" });
    if (slot.current) observer.observe(slot.current);
    return () => observer.disconnect();
  }, [lazy, viewport]);
  useEffect(() => {
    if (!visible || pdf) return;
    let active = true; let owned: string | undefined; setError(""); setUrl(undefined); setImageReady(false);
    void api.readPage(book.id, index).then((data) => {
      if (!active) return;
      owned = URL.createObjectURL(new Blob([data], { type: size.mime })); setUrl(owned);
    }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; if (owned) URL.revokeObjectURL(owned); };
  }, [visible, book.id, index, pdf, size.mime]);
  useEffect(() => {
    if (!visible || !pdf) return;
    let active = true; let task: RenderTask | undefined; setError("");
    void pdf.getPage(index + 1).then(async (page) => {
      const node = canvas.current; if (!active || !node) return;
      const original = page.getViewport({ scale: 1 });
      // Cap raster size to avoid oversized canvases at high zoom/DPI.
      const scale = Math.min(width / original.width * Math.min(window.devicePixelRatio || 1, 2), Math.sqrt(16_000_000 / (original.width * original.height)));
      const view = page.getViewport({ scale });
      node.width = Math.ceil(view.width); node.height = Math.ceil(view.height);
      const context = node.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable");
      task = page.render({ canvas: node, canvasContext: context, viewport: view, background: "#ffffff" });
      await task.promise;
    }).catch((e: unknown) => {
      if (active && !(e instanceof Error && e.name === "RenderingCancelledException")) setError(errorText(e));
    });
    return () => { active = false; task?.cancel(); };
  }, [visible, pdf, index, width]);
  // In scroll mode, once an image has decoded, let its intrinsic aspect ratio
  // define the element height. This avoids white seams when archive metadata
  // is slightly wrong (common in stitched manhwa/webtoon chapters).
  const intrinsicScrollImage = scrollMode && visible && imageReady && !pdf;
  return <div ref={(node) => { slot.current = node; elementRef(node); }} className={`page-slot${intrinsicScrollImage ? " intrinsic-scroll-image" : ""}`} style={intrinsicScrollImage ? { width } : { width, aspectRatio: `${size.width} / ${size.height}` }} aria-label={`Comic page ${index + 1}`}>
    {visible && (error ? <div className="page-error" role="alert">Page {index + 1}<p>{error}</p></div> : pdf ? <canvas ref={canvas} /> : url ? <img src={url} alt={`Comic page ${index + 1}`} draggable={false} decoding="async" onLoad={() => setImageReady(true)} onError={() => setError("This image could not be decoded.")} /> : <span className="page-placeholder">Loading page {index + 1}...</span>)}
    {!visible && <span className="page-placeholder">{index + 1}</span>}
  </div>;
}

export function Reader({ book, preferences, onExit, onChapter, onProgress, notify }: {
  book: Book; preferences: Preferences; onExit: () => void; onChapter: (step: 1 | -1) => Promise<void>;
  onProgress: (id: string, progress: Progress) => void; notify: (message: string, error?: boolean) => void;
}) {
  const initial: Progress = book.lastRead ? book.progress : { ...book.progress, direction: preferences.direction, mode: preferences.mode };
  const [progress, setProgress] = useState<Progress>(initial);
  const latest = useRef(initial);
  const [pages, setPages] = useState<PageSize[]>(book.kind === "images" ? book.pages : []);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [opening, setOpening] = useState(book.kind === "pdf"); const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [pageInput, setPageInput] = useState(String(initial.page + 1)); const [switching, setSwitching] = useState(false);
  const [readingLocked, setReadingLocked] = useState(false); const readingLockedRef = useRef(false);
  const [flipEnabled, setFlipEnabled] = useState(() => localStorage.getItem("ippo:page-flip") === "1");
  const [flipTransition, setFlipTransition] = useState<{ from: number; to: number; turn: "left" | "right" } | null>(null);
  const flipTimer = useRef<number | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null); const frames = useRef<(HTMLDivElement | null)[]>([]);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 700 });
  const restoring = useRef(true); const mounted = useRef(true); const navigationBusy = useRef(false);
  const callbacks = useRef({ onExit, onChapter, onProgress, notify }); callbacks.current = { onExit, onChapter, onProgress, notify };
  const queue = useRef<SaveQueue<Progress> | null>(null);
  if (!queue.current) queue.current = new SaveQueue(async (value) => {
    if (mounted.current) setSaveState("saving");
    await api.saveProgress(book.id, value);
    if (mounted.current) { setSaveState("saved"); callbacks.current.onProgress(book.id, value); }
  }, (e) => { if (mounted.current) { setSaveState("error"); callbacks.current.notify(`Bookmark was not saved: ${errorText(e)}`, true); } });
  const writer = queue.current;
  const ready = !opening && !error && pages.length > 0;
  useReadingTime(book.id, preferences.readingTimeTracking);

  useEffect(() => {
    mounted.current = true; const untrack = trackQueue(writer);
    const flush = () => { void writer.flush().catch(() => {}); };
    window.addEventListener("pagehide", flush); window.addEventListener("blur", flush);
    return () => { mounted.current = false; untrack(); window.removeEventListener("pagehide", flush); window.removeEventListener("blur", flush); };
  }, [writer]);

  useEffect(() => {
    if (book.kind !== "pdf") return;
    const controller = new AbortController(); let document: PDFDocumentProxy | undefined;
    void (async () => {
      const data = await api.readPage(book.id, 0);
      if (controller.signal.aborted) return;
      const result = await openPdf(data, book.pages, controller.signal, (nextPages, complete) => {
        if (controller.signal.aborted || !mounted.current) return;
        setPages(nextPages);
        if (complete) void api.setPdfPages(book.id, nextPages).catch((e) => callbacks.current.notify(`PDF page map was not cached: ${errorText(e)}`, true));
      }); document = result.document;
      if (controller.signal.aborted) { await document.destroy(); return; }
      latest.current = { ...latest.current, page: clamp(latest.current.page, 0, result.pages.length - 1) };
      setProgress(latest.current); setPdf(document); setPages(result.pages); setOpening(false);
      if (book.pages.length === result.pages.length && book.pages.length > 0) {
        // Existing cached geometry is already usable; background hydration only refreshes it.
      }
    })().catch((e) => { if (!controller.signal.aborted) { setError(errorText(e)); setOpening(false); } });
    return () => { controller.abort(); if (document) void document.destroy(); };
    // A Reader instance is keyed by book ID. Bookmarks must never reopen the PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    const node = viewport.current; if (!node) return;
    const observer = new ResizeObserver(() => setDimensions({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => setPageInput(String(progress.page + 1)), [progress.page]);

  const page = clamp(progress.page, 0, Math.max(0, pages.length - 1));
  const currentSize = pages[page] ?? { width: 760, height: 1080 };
  const availableWidth = Math.max(240, dimensions.width - 56);
  const baseWidth = progress.mode === "paged" ? Math.min(availableWidth, Math.max(200, dimensions.height - 48) * currentSize.width / currentSize.height) : Math.min(980, availableWidth);
  const pageWidth = Math.round(baseWidth * progress.zoom);
  const layoutPage = progress.mode === "paged" ? page : -1;

  function update(next: Progress, immediate = false) {
    latest.current = next; setProgress(next);
    if (!ready) return;
    writer.schedule({ ...next }, immediate ? 0 : 180);
    if (immediate) void writer.flush().catch((e) => { if (mounted.current) { setSaveState("error"); notify(`Bookmark was not saved: ${errorText(e)}`, true); } });
  }
  function positionOf(node: HTMLElement): number {
    const root = viewport.current!;
    return node.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  }
  useLayoutEffect(() => {
    if (!ready || !viewport.current) return;
    restoring.current = true;
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      const node = viewport.current; if (!node) return;
      if (latest.current.mode === "scroll") {
        const target = frames.current[latest.current.page];
        if (target) node.scrollTop = latest.current.page === 0 && latest.current.offset === 0 ? 0 : positionOf(target) + target.offsetHeight * latest.current.offset;
      } else { node.scrollTop = 0; node.scrollLeft = 0; }
      writer.schedule({ ...latest.current });
      nextFrame = requestAnimationFrame(() => { restoring.current = false; });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
  }, [ready, progress.mode, progress.zoom, dimensions.width, dimensions.height, layoutPage, pageWidth, writer]);

  function recordScroll() {
    const root = viewport.current;
    if (!root || restoring.current || !ready || latest.current.mode !== "scroll") return;
    let index: number; let offset: number;
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) { index = pages.length - 1; offset = 1; }
    else {
      const top = root.getBoundingClientRect().top + 1;
      let low = 0; let high = pages.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((frames.current[middle]?.getBoundingClientRect().bottom ?? Infinity) <= top) low = middle + 1;
        else high = middle;
      }
      index = low;
      const frame = frames.current[index]; if (!frame) return;
      offset = clamp((root.scrollTop - positionOf(frame)) / frame.offsetHeight, 0, 1);
    }
    if (latest.current.page !== index || Math.abs(latest.current.offset - offset) > 0.0005) update({ ...latest.current, page: index, offset });
  }
  const scrollFrame = useRef<number | undefined>(undefined);
  const onScroll = () => {
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = undefined; recordScroll(); });
  };
  useEffect(() => () => {
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    if (flipTimer.current !== undefined) window.clearTimeout(flipTimer.current);
  }, []);

  function setFlip(next: boolean) {
    setFlipEnabled(next);
    localStorage.setItem("ippo:page-flip", next ? "1" : "0");
    if (!next) {
      setFlipTransition(null);
      if (flipTimer.current !== undefined) window.clearTimeout(flipTimer.current);
      flipTimer.current = undefined;
    }
  }

  function seek(target: number) {
    if (!ready) return;
    const next = Math.round(clamp(target, 0, pages.length - 1));
    const previous = latest.current.page;
    if (latest.current.mode === "scroll") {
      const node = frames.current[next];
      if (node && viewport.current) {
        restoring.current = true; viewport.current.scrollTop = next === 0 ? 0 : positionOf(node);
        requestAnimationFrame(() => { restoring.current = false; recordScroll(); });
      }
    } else if (flipEnabled && next !== previous) {
      if (flipTimer.current !== undefined) window.clearTimeout(flipTimer.current);
      setFlipTransition({ from: previous, to: next, turn: pageTurnSide(previous, next, latest.current.direction) });
      flipTimer.current = window.setTimeout(() => { setFlipTransition(null); flipTimer.current = undefined; }, 430);
    }
    update({ ...latest.current, page: next, offset: 0 }, true);
  }
  async function exit() {
    if (navigationBusy.current) return;
    navigationBusy.current = true;
    try { recordScroll(); await writer.flush(); callbacks.current.onExit(); }
    catch (e) { setSaveState("error"); notify(`Could not save your bookmark: ${errorText(e)}`, true); }
    finally { navigationBusy.current = false; }
  }
  async function chapter(step: 1 | -1) {
    if (navigationBusy.current || !ready) return;
    navigationBusy.current = true; setSwitching(true);
    try { recordScroll(); await writer.flush(); await callbacks.current.onChapter(step); }
    catch (e) { notify(errorText(e), true); }
    finally { navigationBusy.current = false; if (mounted.current) setSwitching(false); }
  }
  const actions = useRef({ seek, chapter, exit, update, recordScroll, ready });
  actions.current = { seek, chapter, exit, update, recordScroll, ready };
  useEffect(() => {
    const tap = new SpaceTap((step) => {
      if (!actions.current.ready) return;
      if (latest.current.mode === "scroll" && viewport.current) viewport.current.scrollBy({ top: step * viewport.current.clientHeight * 0.85, behavior: "auto" });
      else actions.current.seek(latest.current.page + step);
    }, (step) => { void actions.current.chapter(step); });
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]") || isEditable(event.target) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if ((key === "1" || key === "2") && actions.current.ready && !readingLockedRef.current) {
          event.preventDefault(); actions.current.recordScroll(); actions.current.update({ ...latest.current, mode: key === "1" ? "paged" : "scroll" }, true);
        }
        return;
      }
      if (event.code === "Space") { event.preventDefault(); if (!event.repeat) tap.press(event.shiftKey ? -1 : 1); return; }
      tap.cancel();
      if (key === "escape") { event.preventDefault(); void actions.current.exit(); return; }
      if (key === "f") { event.preventDefault(); void api.fullscreen().catch((e) => callbacks.current.notify(errorText(e), true)); return; }
      if (!actions.current.ready) return;
      if (key === "r" && !readingLockedRef.current) { event.preventDefault(); actions.current.update({ ...latest.current, direction: latest.current.direction === "rtl" ? "ltr" : "rtl" }, true); return; }
      const delta = pageDelta(event.key, latest.current.direction);
      if (delta) { event.preventDefault(); actions.current.seek(latest.current.page + delta); }
    };
    window.addEventListener("keydown", keydown);
    return () => { tap.cancel(); window.removeEventListener("keydown", keydown); };
  }, []);

  const percentage = progressPercent(progress, pages.length);
  return <main className="reader" aria-label="Comic reader">
    <header className="reader-toolbar">
      <button className="icon-button" title="Back to shelf (Escape)" aria-label="Back to shelf" onClick={() => void exit()}><Icon name="back" /></button>
      <div className="reader-title"><strong>{book.series}</strong><span>{book.title}</span></div>
      <div className="segmented" aria-label="Reading mode"><button className={progress.mode === "paged" ? "selected" : ""} disabled={!ready || readingLocked} aria-pressed={progress.mode === "paged"} onClick={() => { recordScroll(); update({ ...latest.current, mode: "paged" }, true); }}><Icon name="book" size={16} />Paged</button><button className={progress.mode === "scroll" ? "selected" : ""} disabled={!ready || readingLocked} aria-pressed={progress.mode === "scroll"} onClick={() => { setFlipTransition(null); update({ ...latest.current, mode: "scroll" }, true); }}><Icon name="scroll" size={16} />Scroll</button></div>
      <button className={`reader-flip-toggle${flipEnabled ? " selected" : ""}`} disabled={!ready || readingLocked || progress.mode === "scroll"} title={progress.mode === "scroll" ? "Page flip is available in Paged mode only" : flipEnabled ? "Turn page flip animation off" : "Turn page flip animation on"} aria-label="Page flip animation" aria-pressed={flipEnabled} onClick={() => setFlip(!flipEnabled)}><Icon name="flip" size={16} />Flip</button>
      <label className="reader-direction"><span className="sr-only">Reading direction</span><select value={progress.direction} disabled={!ready || readingLocked} onChange={(e) => update({ ...latest.current, direction: e.target.value as Progress["direction"] }, true)}><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select></label>
      <button className={`icon-button reading-lock${readingLocked ? " selected" : ""}`} title={readingLocked ? "Unlock reading settings" : "Lock reading settings"} aria-label={readingLocked ? "Unlock reading settings" : "Lock reading settings"} aria-pressed={readingLocked} onClick={() => { const next = !readingLockedRef.current; readingLockedRef.current = next; setReadingLocked(next); }}><Icon name={readingLocked ? "lock" : "unlock"} /></button>
      <button className="icon-button" title="Fullscreen (F)" aria-label="Toggle fullscreen" onClick={() => void api.fullscreen().catch((e) => notify(errorText(e), true))}><Icon name="expand" /></button>
    </header>
    {saveState === "error" && <div className="reader-save-error" role="alert">Your last bookmark could not be saved.<button onClick={() => void writer.flush().catch((e) => notify(errorText(e), true))}>Retry</button><button onClick={onExit}>Leave without saving</button></div>}
    <div className="reader-viewport" ref={viewport} onScroll={onScroll}>
      {opening ? <div className="reader-message"><span className="spinner" /><h2>Opening your comic...</h2><p>Preparing pages and restoring your bookmark.</p></div> : error ? <div className="reader-message"><Icon name="book" size={38} /><h2>This comic could not be opened.</h2><p>{error}</p><button className="secondary" onClick={onExit}>Back to shelf</button></div> :
        <div className={`reader-pages ${progress.mode === "scroll" ? "scroll-mode" : "paged-mode"}`} style={{ minWidth: progress.mode === "scroll" ? pageWidth : pageWidth + 48 }}>
          {progress.mode === "paged" ? pages[page] && (flipEnabled ?
            <div className={`page-flip-stage${flipTransition ? ` turn-${flipTransition.turn}` : ""}`} style={{ width: pageWidth, aspectRatio: `${pages[page]?.width ?? currentSize.width} / ${pages[page]?.height ?? currentSize.height}` }}>
              <div className="page-flip-under"><PageSurface key={`paged-base-${page}`} book={book} index={page} size={pages[page]} width={pageWidth} pdf={pdf} viewport={viewport} lazy={false} scrollMode={false} elementRef={(node) => { frames.current[page] = node; }} /></div>
              {flipTransition && <div className="page-flip-sheet"><PageSurface key={`flip-over-${flipTransition.from}`} book={book} index={flipTransition.from} size={pages[flipTransition.from]!} width={pageWidth} pdf={pdf} viewport={viewport} lazy={false} scrollMode={false} elementRef={(node) => { frames.current[flipTransition.from] = node; }} /></div>}
            </div> :
            <PageSurface key={`paged-${page}`} book={book} index={page} size={pages[page]} width={pageWidth} pdf={pdf} viewport={viewport} lazy={false} scrollMode={false} elementRef={(node) => { frames.current[page] = node; }} />) :
            pages.map((size, index) => <PageSurface key={`scroll-${index}`} book={book} index={index} size={size} width={pageWidth} pdf={pdf} viewport={viewport} lazy scrollMode elementRef={(node) => { frames.current[index] = node; }} />)}
        </div>}
    </div>
    <footer className="reader-footer">
      <div className="reader-page-controls"><button className="icon-button" aria-label="Previous page" disabled={!ready || page === 0} onClick={() => seek(page - 1)}><Icon name={progress.direction === "rtl" ? "right" : "left"} /></button>
        <form onSubmit={(e) => { e.preventDefault(); seek(Number(pageInput) - 1); }}><input aria-label="Page number" type="number" min="1" max={pages.length || 1} disabled={!ready} value={pageInput} onChange={(e) => setPageInput(e.target.value)} onBlur={() => setPageInput(String(page + 1))} /><span>/ {pages.length || "--"}</span></form>
        <button className="icon-button" aria-label="Next page" disabled={!ready || page >= pages.length - 1} onClick={() => seek(page + 1)}><Icon name={progress.direction === "rtl" ? "left" : "right"} /></button></div>
      <div className="reader-progress"><input aria-label="Jump to page" type="range" min="0" max={Math.max(0, pages.length - 1)} value={page} disabled={!ready} onChange={(e) => seek(Number(e.target.value))} /><span>{Math.round(percentage)}%</span></div>
      <label className="zoom-control"><span>Zoom</span><input aria-label="Zoom" type="range" min="0.6" max="1.6" step="0.1" value={progress.zoom} onChange={(e) => { recordScroll(); update({ ...latest.current, zoom: clamp(Number(e.target.value), 0.6, 1.6) }, true); }} /><span>{Math.round(progress.zoom * 100)}%</span></label>
      <button className="text-button next-chapter" disabled={!ready || switching} title="Double-tap Space" onClick={() => void chapter(1)}>Next chapter<Icon name="right" size={15} /></button>
    </footer>
    <div className="reader-status"><span>{saveState === "saving" ? "Saving bookmark..." : saveState === "error" ? "Bookmark not saved" : "Bookmarks save automatically"}</span><span>{readingLocked ? "Reading settings locked" : progress.direction === "rtl" ? "Right to left" : "Left to right"}{progress.mode === "paged" && flipEnabled ? " · Page flip on" : ""} &middot; Double Space for next chapter</span></div>
  </main>;
}
