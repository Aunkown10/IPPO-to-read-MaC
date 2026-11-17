import { useEffect, useMemo, useRef, useState } from "react";
import type { Book, NovelDocument, Preferences, Progress } from "../types";
import { api } from "../lib/api";
import { clamp, errorText, isEditable, SaveQueue, SpaceTap } from "../lib/logic";
import { trackQueue } from "../lib/progress";
import { useReadingTime } from "../lib/readingTime";
import { Icon } from "./Icon";

type NovelTheme = "paper" | "warm" | "sepia" | "night" | "oled";
interface NovelPrefs { theme: NovelTheme; fontSize: number; lineHeight: number; width: number; font: "serif" | "sans" }
const KEY = "ippo:novel-reader-v1";
function loadNovelPrefs(): NovelPrefs {
  try {
    const x = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      theme: ["paper","warm","sepia","night","oled"].includes(x.theme) ? x.theme : "warm",
      fontSize: Number.isFinite(x.fontSize) ? clamp(x.fontSize, 14, 34) : 20,
      lineHeight: Number.isFinite(x.lineHeight) ? clamp(x.lineHeight, 1.2, 2.2) : 1.7,
      width: Number.isFinite(x.width) ? clamp(x.width, 520, 980) : 720,
      font: x.font === "sans" ? "sans" : "serif",
    };
  } catch { return { theme: "warm", fontSize: 20, lineHeight: 1.7, width: 720, font: "serif" }; }
}

export function NovelReader({ book, preferences, onExit, onProgress, notify }: {
  book: Book; preferences: Preferences; onExit: () => void;
  onProgress: (id: string, progress: Progress) => void; notify: (message: string, error?: boolean) => void;
}) {
  const [document, setDocument] = useState<NovelDocument | null>(null);
  const [opening, setOpening] = useState(true); const [error, setError] = useState("");
  const [prefs, setPrefs] = useState(loadNovelPrefs); const [controls, setControls] = useState(false);
  const initial = book.lastRead ? book.progress : { ...book.progress, page: 0, offset: 0, mode: "scroll" as const };
  const [progress, setProgress] = useState<Progress>(initial); const latest = useRef(initial);
  const viewport = useRef<HTMLDivElement>(null); const mounted = useRef(true);
  const queue = useRef<SaveQueue<Progress> | null>(null);
  if (!queue.current) queue.current = new SaveQueue(async (value) => {
    await api.saveProgress(book.id, value); if (mounted.current) onProgress(book.id, value);
  }, (e) => notify(`Bookmark was not saved: ${errorText(e)}`, true));
  const writer = queue.current;
  useReadingTime(book.id, preferences.readingTimeTracking);

  useEffect(() => {
    mounted.current = true; const untrack = trackQueue(writer);
    void api.readNovel(book.id).then((doc) => { setDocument(doc); setOpening(false); }).catch((e) => { setError(errorText(e)); setOpening(false); });
    return () => { mounted.current = false; untrack(); void writer.flush().catch(() => {}); };
  }, [book.id, writer]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} }, [prefs]);
  useEffect(() => {
    if (!document) return;
    const node = viewport.current; if (!node) return;
    const frame = requestAnimationFrame(() => {
      const max = Math.max(0, node.scrollHeight - node.clientHeight);
      node.scrollTop = max * clamp(latest.current.offset, 0, 1);
    });
    return () => cancelAnimationFrame(frame);
  // restore once when the chosen chapter's text mounts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, progress.page]);

  const chapter = document?.chapters[clamp(progress.page, 0, Math.max(0, (document?.chapters.length ?? 1) - 1))];
  const paragraphs = useMemo(() => chapter?.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) ?? [], [chapter]);
  const savePosition = () => {
    const node = viewport.current; if (!node || !document) return;
    const max = Math.max(1, node.scrollHeight - node.clientHeight);
    const next = { ...latest.current, page: progress.page, offset: clamp(node.scrollTop / max, 0, 1), mode: "scroll" as const };
    latest.current = next; setProgress(next); writer.schedule(next);
  };
  const changeChapter = (nextIndex: number) => {
    if (!document) return;
    const page = clamp(nextIndex, 0, document.chapters.length - 1);
    const next = { ...latest.current, page, offset: 0, mode: "scroll" as const };
    latest.current = next; setProgress(next); writer.schedule(next);
    requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = 0; });
  };
  const completeBook = () => {
    if (!document) return;
    const next = { ...latest.current, page: document.chapters.length - 1, offset: 1, mode: "scroll" as const };
    latest.current = next; setProgress(next); writer.schedule(next);
    notify("Book marked complete.");
  };
  const shortcutState = useRef({ page: progress.page, controls, changeChapter, onExit, notify });
  shortcutState.current = { page: progress.page, controls, changeChapter, onExit, notify };
  useEffect(() => {
    const tap = new SpaceTap((step) => {
      const node = viewport.current;
      if (!node) return;
      node.scrollBy({ top: step * node.clientHeight * 0.85, behavior: "auto" });
    }, (step) => shortcutState.current.changeChapter(shortcutState.current.page + step));
    const key = (e: KeyboardEvent) => {
      if (window.document.querySelector("dialog[open]") || isEditable(e.target)) return;
      const lower = e.key.toLowerCase();
      if (e.code === "Space" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!e.repeat) tap.press(e.shiftKey ? -1 : 1);
        return;
      }
      tap.cancel();
      if (e.key === "Escape") {
        e.preventDefault();
        if (shortcutState.current.controls) setControls(false);
        else shortcutState.current.onExit();
        return;
      }
      if (lower === "a" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); setControls((value) => !value); return;
      }
      if (e.key === "ArrowRight" && e.altKey) { e.preventDefault(); shortcutState.current.changeChapter(shortcutState.current.page + 1); return; }
      if (e.key === "ArrowLeft" && e.altKey) { e.preventDefault(); shortcutState.current.changeChapter(shortcutState.current.page - 1); return; }
      if (lower === "f" && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); void api.fullscreen().catch((x) => shortcutState.current.notify(errorText(x), true)); }
    };
    window.addEventListener("keydown", key);
    return () => { tap.cancel(); window.removeEventListener("keydown", key); };
  // NovelReader is keyed by book ID; refs keep live chapter/control state without rebuilding the shortcut listener.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (opening) return <div className="novel-reader novel-warm"><div className="novel-loading"><span className="spinner" /><p>Opening your book...</p></div></div>;
  if (error || !document || !chapter) return <div className="novel-reader novel-warm"><div className="novel-loading"><h2>This book could not be opened.</h2><p>{error || "No readable chapters were found."}</p><button className="secondary" onClick={onExit}>Back to novels</button></div></div>;

  const percent = ((progress.page + progress.offset) / Math.max(1, document.chapters.length)) * 100;
  return <div className={`novel-reader novel-${prefs.theme}${controls ? " controls-open" : ""}`}>
    <header className="novel-bar">
      <button className="novel-icon" aria-label="Back to novels" onClick={onExit}><Icon name="left" size={18} /></button>
      <div className="novel-bar-title"><strong>{book.title}</strong><span>{book.metadata.author || book.series}</span></div>
      <button className="novel-icon" title="Reading appearance (A)" aria-label="Reading appearance" aria-expanded={controls} onClick={() => setControls((v) => !v)}><Icon name="settings" size={18} /></button>
    </header>
    {controls && <aside className="novel-settings">
      <label>Theme<select value={prefs.theme} onChange={(e) => setPrefs({ ...prefs, theme: e.target.value as NovelTheme })}><option value="paper">Paper</option><option value="warm">Warm</option><option value="sepia">Sepia</option><option value="night">Night</option><option value="oled">OLED</option></select></label>
      <label>Font<select value={prefs.font} onChange={(e) => setPrefs({ ...prefs, font: e.target.value as "serif" | "sans" })}><option value="serif">Book serif</option><option value="sans">Clean sans</option></select></label>
      <label>Text size<input type="range" min="14" max="34" value={prefs.fontSize} onChange={(e) => setPrefs({ ...prefs, fontSize: Number(e.target.value) })} /></label>
      <label>Line spacing<input type="range" min="1.2" max="2.2" step="0.05" value={prefs.lineHeight} onChange={(e) => setPrefs({ ...prefs, lineHeight: Number(e.target.value) })} /></label>
      <label>Page width<input type="range" min="520" max="980" step="20" value={prefs.width} onChange={(e) => setPrefs({ ...prefs, width: Number(e.target.value) })} /></label>
      <label>Chapter<select value={progress.page} onChange={(e) => changeChapter(Number(e.target.value))}>{document.chapters.map((c, i) => <option key={i} value={i}>{i + 1}. {c.title}</option>)}</select></label>
    </aside>}
    <div className="novel-scroll" ref={viewport} onScroll={savePosition} onPointerDown={() => setControls(false)}>
      <article className={`novel-page font-${prefs.font}`} style={{ maxWidth: prefs.width, fontSize: prefs.fontSize, lineHeight: prefs.lineHeight }}>
        <span className="novel-kicker">CHAPTER {progress.page + 1} OF {document.chapters.length}</span>
        <h1>{chapter.title}</h1>
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        <div className="novel-end">
          {progress.page > 0 && <button className="secondary" onClick={() => changeChapter(progress.page - 1)}>Previous chapter</button>}
          {progress.page < document.chapters.length - 1 ? <button className="primary" onClick={() => changeChapter(progress.page + 1)}>Next chapter</button> : progress.offset >= 0.999 ? <span>Completed</span> : <button className="primary" onClick={completeBook}>Mark complete</button>}
        </div>
      </article>
    </div>
    <footer className="novel-progress"><span>{Math.round(percent)}%</span><span>{book.wordCount.toLocaleString()} words</span></footer>
  </div>;
}
