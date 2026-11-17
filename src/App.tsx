import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Book, Medium, Preferences, Progress, WatchedFolder } from "./types";
import { DEFAULT_PREFERENCES } from "./types";
import { api, previewMode } from "./lib/api";
import { buildShelves, errorText, isBookCompleted, isEditable, orderChapters, seriesKey } from "./lib/logic";
import { flushAllProgress } from "./lib/progress";
import { classifyLocal, classifyWithSources, matchesComicFilter, preferredQuery, CLASSIFIER_VERSION } from "./lib/classification";
import { ClassificationPanel } from "./components/ClassificationPanel";
import { Icon } from "./components/Icon";
import { ContinueCard, EmptyLibrary, ShelfCard, ShelfDetail } from "./components/Library";
import { EditDialog, ImportDialog, ReadingStatsDialog, RoadmapDialog, SettingsDialog, ShortcutsDialog, VaultDialog, WatchedFoldersDialog } from "./components/Dialogs";
import { Reader } from "./components/Reader";
import { MusicPlayer } from "./components/MusicPlayer";
import { NovelReader } from "./components/NovelReader";
import { NovelLibrary } from "./components/NovelLibrary";
import type { ImportReport } from "./types";

type Screen = { type: "library"; filter: "all" | "continue" } | { type: "shelf"; key: string } | { type: "reader"; id: string };
type Dialog = { type: "settings" | "shortcuts" | "watched" | "stats" | "roadmap" } | { type: "vault"; transferId?: string } | { type: "edit"; id: string } | { type: "import"; report: ImportReport } | null;
const PREFS = "ippo-settings-v1";
function loadPreferences(): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    return {
      theme: ["system", "light", "dark"].includes(data.theme) ? data.theme : "system",
      direction: data.direction === "rtl" ? "rtl" : "ltr",
      mode: data.mode === "scroll" ? "scroll" : "paged",
      onlineMetadata: data.onlineMetadata !== false,
      readingTimeTracking: data.readingTimeTracking !== false,
    };
  } catch { return DEFAULT_PREFERENCES; }
}

export function App() {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [books, setBooks] = useState<Book[]>([]); const [privateView, setPrivateView] = useState(false);
  const [space, setSpace] = useState<"comics" | "novels">("comics");
  const [comicFilter, setComicFilter] = useState<"all" | Exclude<Medium, "novel">>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "reading" | "unread" | "completed">("all");
  const [screen, setScreen] = useState<Screen>({ type: "library", filter: "all" });
  const [dialog, setDialog] = useState<Dialog>(null); const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState("");
  const [classificationId, setClassificationId] = useState<string | null>(null);
  const identifyBusy = useRef(false);
  const attemptedClassification = useRef(new Set<string>());
  const [identifyStatus, setIdentifyStatus] = useState("");
  const [busy, setBusy] = useState(false); const [identifying, setIdentifying] = useState(false); const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [coverEpoch, setCoverEpoch] = useState(0);
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([]);
  const scope = useRef(false); const epoch = useRef(0); const requestId = useRef(0);
  const importBusy = useRef(false); const closeBusy = useRef(false); const search = useRef<HTMLInputElement>(null);
  const screenRef = useRef(screen); screenRef.current = screen;
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const refresh = useCallback(async (target = scope.current): Promise<Book[]> => {
    const generation = epoch.current; const request = ++requestId.current;
    setLoading(true); setLoadError("");
    try {
      const next = await api.listBooks(target);
      if (generation === epoch.current && request === requestId.current && target === scope.current) setBooks(next);
      return next;
    } catch (error) {
      if (generation === epoch.current && request === requestId.current) setLoadError(errorText(error));
      throw error;
    } finally {
      if (generation === epoch.current && request === requestId.current) setLoading(false);
    }
  }, []);
  const changeScope = useCallback((target: boolean) => {
    epoch.current += 1; scope.current = target; setClassificationId(null);
    setPrivateView(target); setBooks([]); setQuery(""); setDialog(null); setToast(null); setSpace("comics"); setComicFilter("all"); setStatusFilter("all");
    setScreen({ type: "library", filter: "all" });
    void refresh(target).catch(() => {});
  }, [refresh]);
  const handleLocked = useCallback(() => {
    if (scope.current) changeScope(false);
    else { epoch.current += 1; setDialog((value) => value?.type === "vault" ? null : value); void refresh(false).catch(() => {}); }
  }, [changeScope, refresh]);

  const refreshWatched = useCallback(async () => { if (!previewMode) setWatchedFolders(await api.watchedFolders()); }, []);
  const identifyComicTypes = useCallback(async (sourceBooks: Book[] = books, announce = true) => {
    if (identifyBusy.current || previewMode) return;
    const target = scope.current; const generation = epoch.current;
    const shelves = buildShelves(sourceBooks.filter((b) => b.kind !== "novel" && b.isPrivate === target));
    if (!shelves.length) return;
    identifyBusy.current = true; setIdentifying(true);
    let unresolved = 0; let identified = 0;
    try {
      for (let index = 0; index < shelves.length; index += 1) {
        if (epoch.current !== generation || scope.current !== target) break;
        const shelf = shelves[index];
        setIdentifyStatus(`${index + 1}/${shelves.length}: ${shelf.title}`);
        try {
          const latest = await api.classificationBooks(shelf.books[0].id);
          if (epoch.current !== generation || !latest.length) break;
          let decision = classifyLocal(latest);
          if (decision.locked) continue;
          if (!target && preferences.onlineMetadata && decision.status !== "confirmed") {
            const lookup = await api.classificationSources(latest[0].id, preferredQuery(latest));
            if (epoch.current !== generation) break;
            decision = classifyWithSources(latest, lookup).decision;
          }
          await api.applyClassification(latest[0].id, decision);
          if (decision.status === "confirmed") identified += 1; else unresolved += 1;
          if (!target && preferences.onlineMetadata) await new Promise((resolve) => setTimeout(resolve, 1100));
        } catch (e) {
          unresolved += 1;
          if (epoch.current === generation) notify(`Classification failed for ${shelf.title}: ${errorText(e)}`, true);
        }
      }
      if (epoch.current === generation) {
        await refresh(target);
        if (announce) {
          setComicFilter("all");
          notify(`Checked ${shelves.length} shelves: ${identified} confirmed; ${unresolved} need review. Right-click a shelf > Classification / fix type to see evidence or set its type.`, unresolved > 0);
        }
      }
    } finally { identifyBusy.current = false; setIdentifying(false); setIdentifyStatus(""); }
  }, [books, notify, preferences.onlineMetadata, refresh]);
  useEffect(() => {
    if (previewMode || identifying || loading) return;
    const pending = books.filter((b) => b.kind !== "novel" && !b.metadata.classification?.locked &&
      (b.metadata.classification?.version ?? 0) < CLASSIFIER_VERSION && !attemptedClassification.current.has(b.id));
    if (!pending.length) return;
    for (const b of pending) attemptedClassification.current.add(b.id);
    void identifyComicTypes(pending, false);
  }, [books, identifying, loading, identifyComicTypes]);
  useEffect(() => { void refresh().catch(() => {}); void refreshWatched().catch(() => {}); }, [refresh, refreshWatched]);
  useEffect(() => {
    let disposed = false; let off = () => {};
    void api.onLibraryUpdated(() => { if (!scope.current) void refresh(false).catch(() => {}); })
      .then((unsubscribe) => { if (disposed) unsubscribe(); else off = unsubscribe; }).catch(() => {});
    return () => { disposed = true; off(); };
  }, [refresh]);
  useEffect(() => {
    let disposed = false; let off = () => {};
    void api.onVaultLocked(handleLocked).then((unsubscribe) => { if (disposed) unsubscribe(); else off = unsubscribe; }).catch((e) => notify(errorText(e), true));
    return () => { disposed = true; off(); };
  }, [handleLocked, notify]);
  useEffect(() => {
    let disposed = false; let off = () => {};
    void api.onClose(async () => {
      if (closeBusy.current) return;
      closeBusy.current = true;
      try { await flushAllProgress(); await api.quit(); }
      catch (e) { notify(`The app stayed open because a bookmark could not be saved: ${errorText(e)}`, true); closeBusy.current = false; }
    }).then((unsubscribe) => { if (disposed) unsubscribe(); else off = unsubscribe; }).catch((e) => notify(errorText(e), true));
    return () => { disposed = true; off(); };
  }, [notify]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = preferences.theme === "system" ? media.matches ? "dark" : "light" : preferences.theme; };
    apply(); media.addEventListener("change", apply);
    try { localStorage.setItem(PREFS, JSON.stringify(preferences)); } catch { notify("Settings could not be saved on this device.", true); }
    return () => media.removeEventListener("change", apply);
  }, [preferences, notify]);
  useEffect(() => {
    const blur = () => { document.documentElement.dataset.focused = "false"; };
    const focus = () => {
      if (!scope.current) { document.documentElement.dataset.focused = "true"; return; }
      const generation = epoch.current;
      void api.vaultStatus().then((status) => {
        if (generation !== epoch.current) return;
        if (!status.unlocked) handleLocked();
        if (document.hasFocus()) document.documentElement.dataset.focused = "true";
      }).catch(handleLocked);
    };
    document.documentElement.dataset.focused = "true";
    window.addEventListener("blur", blur); window.addEventListener("focus", focus);
    return () => { window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); };
  }, [handleLocked]);
  useEffect(() => {
    if (!privateView) return;
    let lastTouch = 0;
    const touch = () => {
      const now = Date.now(); if (now - lastTouch < 10_000) return; lastTouch = now;
      void api.touchVault().catch(handleLocked);
    };
    const check = setInterval(() => { void api.vaultStatus().then((s) => { if (!s.unlocked) handleLocked(); }).catch(handleLocked); }, 20_000);
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(type, touch, { passive: true });
    return () => { clearInterval(check); for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(type, touch); };
  }, [privateView, handleLocked]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 12000 : 5000); return () => clearTimeout(timer); }, [toast]);

  const importComics = useCallback(async (folder = false) => {
    if (importBusy.current) return;
    importBusy.current = true; setBusy(true);
    const generation = epoch.current; const target = scope.current;
    try {
      const report = await api.importBooks(folder, target);
      if (generation !== epoch.current) return;
      await refresh(target);
      if (generation !== epoch.current) return;
      if (!target && report.imported.some((book) => book.kind !== "novel" && !book.metadata.classification?.locked)) void identifyComicTypes(report.imported, false);
      if (report.errors.length || report.warnings.length) setDialog({ type: "import", report });
      else if (report.imported.length) notify(target ? `${report.imported.length} encrypted private ${report.imported.length === 1 ? "chapter / volume" : "chapters / volumes"} added. Ippo now has its own copy, so you may delete the originals.` : `${report.imported.length} ${report.imported.length === 1 ? "chapter / volume" : "chapters / volumes"} added. Matching series are grouped into one comic shelf.`);
    } catch (e) { if (generation === epoch.current) notify(errorText(e), true); }
    finally { importBusy.current = false; setBusy(false); }
  }, [identifyComicTypes, notify, preferences.onlineMetadata, refresh]);

  const importNovels = useCallback(async () => {
    if (importBusy.current) return;
    importBusy.current = true; setBusy(true);
    const generation = epoch.current; const target = scope.current;
    try {
      const report = await api.importNovels(target);
      if (generation !== epoch.current) return;
      await refresh(target);
      if (generation !== epoch.current) return;
      const importedNovels = report.imported.filter((book) => book.kind === "novel" || book.metadata.medium === "novel");
      if (report.errors.length || report.warnings.length) setDialog({ type: "import", report });
      else if (importedNovels.length) notify(target ? `${importedNovels.length} encrypted private ${importedNovels.length === 1 ? "novel" : "novels"} added. Ippo now has its own copy, so you may delete the originals.` : `${importedNovels.length} ${importedNovels.length === 1 ? "novel" : "novels"} added to your bookshelf.`);
    } catch (e) { if (generation === epoch.current) notify(errorText(e), true); }
    finally { importBusy.current = false; setBusy(false); }
  }, [notify, refresh]);

  const watchComicFolder = useCallback(async () => {
    if (scope.current) { notify("Watched folders are only available in the normal library. Private comics and novels must be imported manually.", true); return; }
    setBusy(true);
    try {
      const result = await api.watchComicFolder();
      await refreshWatched(); await refresh(false);
      if (result.imported.some((book) => book.kind !== "novel" && !book.metadata.classification?.locked)) void identifyComicTypes(result.imported, false);
      if (result.errors.length) notify(`Folder added, but ${result.errors.length} file${result.errors.length === 1 ? "" : "s"} could not be imported.`, true);
      else if (result.imported.length || result.matchedExisting) {
        const parts: string[] = [];
        if (result.imported.length) parts.push(`${result.imported.length} new ${result.imported.length === 1 ? "item" : "items"} imported`);
        if (result.matchedExisting) parts.push(`${result.matchedExisting} existing ${result.matchedExisting === 1 ? "item" : "items"} linked without duplicates`);
        notify(`${parts.join("; ")}. Ippo will keep watching that folder.`);
      } else notify("Library folder is now being watched. New supported files will appear automatically.");
    } catch (e) { notify(errorText(e), true); } finally { setBusy(false); }
  }, [identifyComicTypes, notify, preferences.onlineMetadata, refresh, refreshWatched]);
  const syncWatched = useCallback(async () => {
    const result = await api.syncWatchedFolders(); await refresh(false); await refreshWatched();
    if (result.imported.some((book) => book.kind !== "novel" && !book.metadata.classification?.locked)) void identifyComicTypes(result.imported, false);
    if (result.errors.length) notify(`${result.errors.length} watched file${result.errors.length === 1 ? "" : "s"} could not be imported.`, true);
    else if (result.imported.length || result.matchedExisting) {
      const parts: string[] = [];
      if (result.imported.length) parts.push(`${result.imported.length} new or changed ${result.imported.length === 1 ? "item" : "items"} imported`);
      if (result.matchedExisting) parts.push(`${result.matchedExisting} existing ${result.matchedExisting === 1 ? "item" : "items"} linked without duplicates`);
      notify(`${parts.join("; ")}.`);
    } else notify("Watched folders are up to date.");
  }, [identifyComicTypes, notify, preferences.onlineMetadata, refresh, refreshWatched]);
  const unwatchFolder = useCallback(async (id: string) => { await api.unwatchComicFolder(id); await refreshWatched(); notify("Stopped watching that folder. Items already copied into Ippo stay in your library."); }, [notify, refreshWatched]);

  const toggleVault = useCallback(async () => {
    if (scope.current) {
      const saving = flushAllProgress();
      changeScope(false); // Remove private DOM/covers immediately, even if an IPC call is still pending.
      await saving.catch(() => notify("Locked view. A pending bookmark could not be saved.", true));
      await api.lockVault().catch((e) => notify(errorText(e), true));
      return;
    }
    try {
      await flushAllProgress();
      const status = await api.vaultStatus();
      if (status.unlocked) changeScope(true);
      else setDialog({ type: "vault" });
    } catch (e) { notify(errorText(e), true); }
  }, [changeScope, notify]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase(); const modifier = event.ctrlKey || event.metaKey;
      const privateShortcut = key === "h" && (event.ctrlKey || (event.metaKey && event.shiftKey));
      if (privateShortcut && !event.repeat) {
        if (!scope.current && document.querySelector("dialog[open]")) return;
        event.preventDefault(); void toggleVault(); return;
      }
      if (document.querySelector("dialog[open]")) return;
      if (modifier && key === "o") { event.preventDefault(); if (!event.repeat) { if (event.shiftKey && !scope.current) void watchComicFolder(); else if (space === "novels") void importNovels(); else void importComics(false); } }
      else if (modifier && key === "f") {
        event.preventDefault();
        void flushAllProgress().then(() => { setScreen({ type: "library", filter: "all" }); requestAnimationFrame(() => search.current?.focus()); }).catch((e) => notify(errorText(e), true));
      } else if (key === "?" && !isEditable(event.target)) { event.preventDefault(); setDialog({ type: "shortcuts" }); }
    };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [importComics, importNovels, notify, space, toggleVault, watchComicFolder]);

  const comicBooks = useMemo(() => books.filter((b) => b.kind !== "novel" && b.metadata.medium !== "novel"), [books]);
  const novelBooks = useMemo(() => books.filter((b) => b.kind === "novel" || b.metadata.medium === "novel"), [books]);
  const filteredComicBooks = useMemo(() => comicBooks.filter((book) => {
    if (!matchesComicFilter(book, comicFilter)) return false;
    if (statusFilter === "reading") return !!book.lastRead && !isBookCompleted(book);
    if (statusFilter === "unread") return !book.lastRead;
    if (statusFilter === "completed") return isBookCompleted(book);
    return true;
  }), [comicBooks, comicFilter, statusFilter]);
  const shelves = useMemo(() => buildShelves(filteredComicBooks), [filteredComicBooks]);
  const allComicShelves = useMemo(() => buildShelves(comicBooks), [comicBooks]);
  const matchingShelves = shelves.filter((shelf) => `${shelf.title} ${shelf.books.map((b) => `${b.title} ${b.metadata.author}`).join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const recentBooks = [...filteredComicBooks].filter((b) => b.lastRead && !isBookCompleted(b) && `${b.series} ${b.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.lastRead - a.lastRead);
  const activeBook = screen.type === "reader" ? books.find((b) => b.id === screen.id) : undefined;
  const activeShelf = screen.type === "shelf" ? allComicShelves.find((s) => s.key === screen.key) : undefined;
  const classificationBook = books.find((b) => b.id === classificationId);
  const editorBook = dialog?.type === "edit" ? books.find((b) => b.id === dialog.id) : undefined;
  const readBook = (book: Book) => { setDialog(null); setScreen({ type: "reader", id: book.id }); };
  const updateProgress = useCallback((id: string, progress: Progress) => {
    setBooks((current) => current.map((book) => book.id === id ? { ...book, progress, lastRead: Date.now() } : book));
  }, []);
  async function changeShelfCover(series: string) {
    try {
      const changed = await api.setShelfCover(series, scope.current);
      if (changed) { setCoverEpoch((value) => value + 1); notify("Shelf image saved inside Ippo. You can delete the original image file."); }
    } catch (e) { notify(errorText(e), true); }
  }
  async function resetShelfCover(series: string) {
    try {
      const removed = await api.removeShelfCover(series, scope.current);
      setCoverEpoch((value) => value + 1);
      notify(removed ? "Custom shelf image removed. Using the chapter cover again." : "This shelf is already using its chapter cover.");
    } catch (e) { notify(errorText(e), true); }
  }
  async function nextChapter(step: 1 | -1) {
    if (!activeBook) return;
    const ordered = orderChapters(books.filter((b) => b.kind !== "novel" && seriesKey(b.series) === seriesKey(activeBook.series)));
    const next = ordered[ordered.findIndex((b) => b.id === activeBook.id) + step];
    if (next) readBook(next);
    else notify(step > 0 ? "You have reached the last imported chapter in this shelf." : "This is the first imported chapter in this shelf.");
  }
  async function transfer(book: Book) {
    const target = !book.isPrivate;
    if (target && !(await api.vaultStatus()).unlocked) { setDialog({ type: "vault", transferId: book.id }); return; }
    const result = await api.transferBook(book.id, target);
    setDialog(null); await refresh();
    notify(result.cleanupWarning ?? `Moved to the ${target ? "private" : "normal"} library. Your original file is unchanged.`, !!result.cleanupWarning);
  }
  async function vaultUnlocked() {
    if (dialog?.type === "vault" && dialog.transferId) {
      const result = await api.transferBook(dialog.transferId, true);
      setDialog(null); await refresh(false);
      notify(result.cleanupWarning ?? "Moved to your encrypted private library. The original file is unchanged.", !!result.cleanupWarning);
    } else changeScope(true);
  }

  return <div className={`app-shell ${privateView ? "private-scope" : ""}`}>
    {activeBook ? (activeBook.kind === "novel" ? <NovelReader key={activeBook.id} book={activeBook} preferences={preferences} notify={notify} onProgress={updateProgress}
      onExit={() => { setSpace("novels"); setScreen({ type: "library", filter: "all" }); void refresh().catch(() => {}); }} /> : <Reader key={activeBook.id} book={activeBook} preferences={preferences} notify={notify} onProgress={updateProgress} onChapter={nextChapter}
      onExit={() => { if (activeBook.metadata.medium === "novel") { setSpace("novels"); setScreen({ type: "library", filter: "all" }); } else { setSpace("comics"); setScreen({ type: "shelf", key: seriesKey(activeBook.series) }); } void refresh().catch(() => {}); }} />) : <>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="book" size={23} /></span><span>Ippo<small>to Read</small></span></div>
        <span className="sidebar-label">{privateView ? "PRIVATE SPACE" : "YOUR SPACE"}</span>
        <nav aria-label="Library navigation">
          <button className={space === "comics" && screen.type !== "reader" ? "active" : ""} onClick={() => { setSpace("comics"); setScreen({ type: "library", filter: "all" }); setQuery(""); }}><Icon name={privateView ? "lock" : "grid"} />{privateView ? "Private comics" : "Comics"}<span className="nav-count">{allComicShelves.length}</span></button>
          <button className={space === "novels" && screen.type !== "reader" ? "active" : ""} onClick={() => { setSpace("novels"); setScreen({ type: "library", filter: "all" }); setQuery(""); }}><Icon name="book" />Novels<span className="nav-count">{novelBooks.length}</span></button>
          {space === "comics" && <button className={screen.type === "library" && screen.filter === "continue" ? "active" : ""} onClick={() => { setScreen({ type: "library", filter: "continue" }); setQuery(""); }}><Icon name="play" />Continue reading</button>}
        </nav>
        <div className="sidebar-note"><span className="small-line" /><p>Your library.<br />Your direction.<br /><strong>Your pace.</strong></p></div>
        <div className="sidebar-bottom">
          <button className="roadmap-trigger" title="Possible future updates" aria-label="Possible future updates" onClick={() => setDialog({ type: "roadmap" })}><Icon name="alert" size={18} /></button>
          <button className="sidebar-action" onClick={() => void toggleVault()}><Icon name="lock" size={18} />{privateView ? "Lock private library" : "Private library"}</button>
          {!privateView && <button className="sidebar-action" onClick={() => setDialog({ type: "watched" })}><Icon name="folder" size={18} />Watched folders{watchedFolders.length ? <span className="nav-count">{watchedFolders.length}</span> : null}</button>}
          <button className="sidebar-action" onClick={() => setDialog({ type: "stats" })}><Icon name="clock" size={18} />Reading time</button>
          <button className="sidebar-action" onClick={() => setDialog({ type: "shortcuts" })}><Icon name="help" size={18} />Keyboard shortcuts</button>
          <button className="sidebar-action" onClick={() => setDialog({ type: "settings" })}><Icon name="settings" size={18} />Settings</button>
          <span className="local-indicator"><i />{previewMode ? "Sample preview" : "Stored on this device"}</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar"><span className="topbar-title">{privateView ? `Private ${space}` : space === "novels" ? "Novels" : "Comics"}{privateView && <Icon name="lock" size={14} />}</span>
          <label className="search"><Icon name="search" size={18} /><input ref={search} aria-label="Search your library" placeholder={space === "novels" ? "Find a book or author..." : "Find a story..."} value={query} onChange={(e) => { setQuery(e.target.value); if (screen.type !== "library") setScreen({ type: "library", filter: "all" }); }} /><kbd>{navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"} F</kbd></label>
          {!privateView && space === "comics" && <button className="icon-button" title="Watch library folder" aria-label="Watch library folder" disabled={busy} onClick={() => void watchComicFolder()}><Icon name="folder" /></button>}
          <button className="primary import-button" disabled={busy} onClick={() => void (space === "novels" ? importNovels() : importComics())}><Icon name="plus" size={17} />{space === "novels" ? "Import novel" : "Import"}</button>
        </header>
        {previewMode && <div className="preview-banner">Interface preview with original sample artwork. Your real files and encrypted vault are available in the desktop app.</div>}
        <main className="library-content">
          {loadError ? <div className="notice error-notice" role="alert"><strong>We could not load the library.</strong><p>{loadError}</p><button className="secondary" onClick={() => void refresh().catch(() => {})}>Try again</button></div> : loading && books.length === 0 ? <div className="loading-state"><span className="spinner" /><p>Opening your library...</p></div> : space === "novels" ?
            <NovelLibrary books={novelBooks} query={query} onRead={readBook} onEdit={(book) => setDialog({ type: "edit", id: book.id })} onImport={() => void importNovels()} /> : activeShelf ?
            <ShelfDetail onClassify={() => setClassificationId(activeShelf.books[0].id)} shelf={activeShelf} onBack={() => setScreen({ type: "library", filter: "all" })} onRead={readBook} onEdit={(book) => setDialog({ type: "edit", id: book.id })}
              privateView={privateView} coverEpoch={coverEpoch} onCoverChange={() => void changeShelfCover(activeShelf.title)} onCoverReset={() => void resetShelfCover(activeShelf.title)} onlineMetadata={preferences.onlineMetadata} /> :
            <div className="enter"><div className="library-heading"><div><span className="eyebrow">{privateView ? "JUST FOR YOU" : "ONE PAGE AT A TIME"}</span><h1>{screen.type === "library" && screen.filter === "continue" ? "Back to your story." : "Your next chapter."}</h1><p>{privateView ? "A quiet space for your personal collection." : "A little escape, right where you left it."}</p></div><span className="library-count">{shelves.length} {shelves.length === 1 ? "comic" : "comics"}<small>{filteredComicBooks.length} {filteredComicBooks.length === 1 ? "chapter / volume" : "chapters / volumes"}</small></span></div>
              <div className="library-filter-stack">
                <div className="library-filters" aria-label="Comic type filters">{(["all","manga","manhwa","manhua","comic","webtoon","unknown"] as const).map((kind) => <button key={kind} className={comicFilter === kind ? "active" : ""} onClick={() => { setComicFilter(kind); setScreen({ type: "library", filter: "all" }); }}>{kind === "all" ? "All types" : kind === "unknown" ? "Unclassified" : kind === "webtoon" ? "Webtoon / long-strip" : kind[0].toUpperCase()+kind.slice(1)}</button>)}</div><button className="text-button identify-types" disabled={identifying} title="Check embedded metadata, source IDs, alternate titles and layout. Private shelves are local-only." onClick={() => void identifyComicTypes()}><Icon name="search" size={14} />{identifying ? "Checking classification..." : "Recheck classification"}</button>{identifyStatus && <p className="fine-print" role="status">{identifyStatus}</p>}
                <div className="library-filters secondary-filters" aria-label="Reading status filters">{(["all","reading","unread","completed"] as const).map((kind) => <button key={kind} className={statusFilter === kind ? "active" : ""} onClick={() => { setStatusFilter(kind); setScreen({ type: "library", filter: "all" }); }}>{kind === "all" ? "Any status" : kind[0].toUpperCase()+kind.slice(1)}</button>)}</div>
              </div>
              {screen.type === "library" && screen.filter === "continue" ?
                recentBooks.length ? <div className="continue-grid full-grid">{recentBooks.map((book) => <ContinueCard key={book.id} book={book} onRead={readBook} />)}</div> : <div className="empty-state"><Icon name="book" size={45} /><h2>Your next read starts here.</h2><p>Open a comic from your library. Its bookmark will appear here automatically.</p><button className="secondary" onClick={() => setScreen({ type: "library", filter: "all" })}>Explore my library</button></div> : <>
                  {recentBooks.length > 0 && !query && <section className="continue-section"><div className="section-heading"><h2>Continue reading</h2><button className="text-button" onClick={() => setScreen({ type: "library", filter: "continue" })}>View all<Icon name="right" size={14} /></button></div><div className="continue-grid">{recentBooks.slice(0, 3).map((book) => <ContinueCard key={book.id} book={book} onRead={readBook} />)}</div></section>}
                  <section><div className="section-heading"><h2>{query ? "Search results" : "Your shelves"}</h2><span>{matchingShelves.length} {matchingShelves.length === 1 ? "comic" : "comics"} &middot; A to Z</span></div>
                    {matchingShelves.length ? <div className="shelf-grid">{matchingShelves.map((shelf) => <ShelfCard onClassify={(book) => setClassificationId(book.id)} key={shelf.key} shelf={shelf} onOpen={(key) => setScreen({ type: "shelf", key })} onRead={readBook} onCoverChange={(series) => void changeShelfCover(series)} onCoverReset={(series) => void resetShelfCover(series)} privateView={privateView} coverEpoch={coverEpoch} />)}</div> : <EmptyLibrary searching={!!query} privateView={privateView} onImport={() => void importComics(false)} onFolder={privateView ? undefined : () => void watchComicFolder()} />}
                  </section>
                </>}
            </div>}
        </main>
        <footer className="library-footer"><span>Ippo to Read</span><span>{privateView ? "Encrypted at rest. Locked when you leave." : space === "novels" ? "A quiet shelf. Offline when you want it." : "Good stories. No distractions."}</span></footer>
      </div>
    </>}
    <MusicPlayer visible notify={notify} />
    {busy && <div className="operation-status" role="status"><span className="spinner small" />Importing and organizing your library...</div>}
    {toast && <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}><span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={17} /></button></div>}
    {dialog?.type === "settings" && <SettingsDialog preferences={preferences} onChange={setPreferences} onClose={() => setDialog(null)} onVault={() => { setDialog(null); void toggleVault(); }} />}
    {dialog?.type === "roadmap" && <RoadmapDialog onClose={() => setDialog(null)} />}
    {dialog?.type === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
    {dialog?.type === "stats" && <ReadingStatsDialog books={books} onClose={() => setDialog(null)} />}
    {dialog?.type === "watched" && <WatchedFoldersDialog folders={watchedFolders} onClose={() => setDialog(null)} onAdd={watchComicFolder} onRemove={unwatchFolder} onSync={syncWatched} />}
    {dialog?.type === "vault" && <VaultDialog forTransfer={!!dialog.transferId} onClose={() => setDialog(null)} onUnlocked={vaultUnlocked} />}
    {dialog?.type === "import" && <ImportDialog report={dialog.report} onClose={() => setDialog(null)} />}
    {editorBook && <EditDialog key={editorBook.id} book={editorBook} onClose={() => setDialog(null)} onTransfer={() => transfer(editorBook)}
      onSave={async (edit) => { const saved = await api.editBook(editorBook.id, edit); setDialog(null); if (saved.kind === "novel" || saved.metadata.medium === "novel") { setSpace("novels"); setScreen({ type: "library", filter: "all" }); } else { setSpace("comics"); setScreen({ type: "shelf", key: seriesKey(edit.series) }); } await refresh(); }}
      onDelete={async () => { const warning = await api.removeBook(editorBook.id); setDialog(null); await refresh(); if (warning) notify(warning, true); else notify("Removed from Ippo. Your original file is untouched."); }} />}
    {classificationBook && <ClassificationPanel key={classificationBook.id} books={books.filter((b) => b.kind !== "novel" && seriesKey(b.series) === seriesKey(classificationBook.series))}
      onlineMetadata={preferences.onlineMetadata} onClose={() => setClassificationId(null)} onChanged={async () => { await refresh(); setComicFilter("all"); }} />}
    {privateView && <div className="privacy-curtain"><span className="brand-mark"><Icon name="lock" size={25} /></span><h2>Private library</h2><p>Concealed while Ippo is not in focus.</p></div>}
  </div>;
}
