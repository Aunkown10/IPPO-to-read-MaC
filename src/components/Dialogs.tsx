import { useEffect, useState, type FormEvent } from "react";
import { api, previewMode } from "../lib/api";
import { errorText } from "../lib/logic";
import type { Book, EditBook, ImportReport, Preferences, WatchedFolder } from "../types";
import { formatReadingTime } from "../lib/readingTime";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

export function VaultDialog({ onClose, onUnlocked, forTransfer = false }: { onClose: () => void; onUnlocked: () => Promise<void>; forTransfer?: boolean }) {
  const RECOVERY_CODE = "000000000000";
  const [configured, setConfigured] = useState<boolean>();
  const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<"menu" | "confirm" | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [resetWarnings, setResetWarnings] = useState<string[]>([]);
  useEffect(() => { let alive = true; void api.vaultStatus().then((s) => { if (alive) setConfigured(s.configured); }).catch((e) => { if (alive) setError(errorText(e)); }); return () => { alive = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (configured && password === RECOVERY_CODE) { setPassword(""); setRecovery("menu"); return; }
    if (configured === false && password !== repeat) { setError("The two passphrases do not match."); return; }
    setBusy(true);
    try {
      if (configured) await api.unlockVault(password); else await api.createVault(password);
      setPassword(""); setRepeat(""); await onUnlocked();
    } catch (e) { setError(errorText(e)); setPassword(""); setRepeat(""); }
    finally { setBusy(false); }
  }
  async function exportBackup() {
    setBusy(true); setError("");
    try { const path = await api.exportVaultBackup(); if (path) setBackupPath(path); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function resetVault() {
    setBusy(true); setError("");
    try {
      const result = await api.resetVault();
      setResetWarnings(result.warnings); setConfigured(false); setRecovery(null); setPassword(""); setRepeat(""); setBackupPath(null);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <Modal title={recovery ? "Private library recovery" : configured === false ? "Your private library" : "Unlock private library"} onClose={() => { if (!busy) onClose(); }}>
    <div className="vault-symbol"><Icon name="lock" size={30} /></div>
    {recovery ? <>
      <p className="muted">The recovery code can reset a forgotten private-library passphrase, but it cannot decrypt files without the old passphrase.</p>
      {recovery === "menu" && <>
        <div className="notice"><strong>Choose carefully.</strong><br />You can save an encrypted backup before resetting. That backup remains locked with the old passphrase and can only be recovered later if you remember it or restore it to a compatible Ippo version.</div>
        {backupPath && <div className="notice">Encrypted backup saved to:<br /><code>{backupPath}</code></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="button-row"><button className="secondary" disabled={busy} onClick={() => void exportBackup()}>{busy ? "Saving..." : "Save encrypted backup first"}</button><button className="danger" disabled={busy} onClick={() => setRecovery("confirm")}>Erase private library</button></div>
        <button className="text-button" disabled={busy} onClick={() => { setRecovery(null); setError(""); }}>Back to unlock</button>
      </>}
      {recovery === "confirm" && <div className="notice danger-notice">
        <p><strong>This removes Ippo's managed private-library records and encrypted comic data, then removes the old passphrase verifier.</strong></p>
        <p>This cannot be undone from inside Ippo. Filesystem remnants, backups, Recycle Bin data, or copies outside Ippo are not guaranteed to be securely erased.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="button-row"><button className="danger" disabled={busy} onClick={() => void resetVault()}>{busy ? "Erasing..." : "Yes, erase and reset"}</button><button className="secondary" disabled={busy} onClick={() => setRecovery("menu")}>Cancel</button></div>
      </div>}
    </> : <>
      <p className="muted">{forTransfer ? "Unlock the vault to encrypt and move this managed comic." : "A separate, encrypted space for your personal collection."}</p>
      {previewMode ? <div className="notice">The browser only previews the interface. Encrypted storage and file imports run in the desktop app: <code>npm run desktop</code>.</div> :
        <form onSubmit={submit}>
          <label className="field">Passphrase<input autoFocus type="password" autoComplete={configured ? "current-password" : "new-password"} minLength={configured ? 1 : 12} maxLength={1024} required value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} /></label>
          {configured === false && <><label className="field">Repeat passphrase<input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={busy} /></label>
            <div className="notice">Use at least 12 characters. Keep it somewhere safe. If you forget it, the recovery code can only wipe/reset the vault or save an encrypted backup; it cannot decrypt your private files.</div></>}
          {resetWarnings.length > 0 && <div className="notice">The old private library was reset.{resetWarnings.map((warning, i) => <div key={i}>{warning}</div>)}</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="primary full" disabled={busy || configured === undefined}>{busy ? "Working..." : configured ? "Unlock library" : "Create new private library"}</button>
        </form>}
      <p className="fine-print">Private copies and their metadata are encrypted. Original files, OS recent-file records and backups outside Ippo are not hidden. The private view is concealed immediately when Ippo loses focus; the vault key is dropped after a short continuous focus loss or five minutes idle.</p>
    </>}
  </Modal>;
}

export function SettingsDialog({ preferences, onChange, onClose, onVault }: { preferences: Preferences; onChange: (prefs: Preferences) => void; onClose: () => void; onVault: () => void }) {
  return <Modal title="Make yourself at home" onClose={onClose}>
    <p className="muted">Small preferences. A more comfortable read.</p>
    <label className="settings-row"><span><strong>Appearance</strong><small>Follow your system or choose a theme.</small></span><select value={preferences.theme} onChange={(e) => onChange({ ...preferences, theme: e.target.value as Preferences["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <label className="settings-row"><span><strong>Default direction</strong><small>Each comic remembers its own setting.</small></span><select value={preferences.direction} onChange={(e) => onChange({ ...preferences, direction: e.target.value as Preferences["direction"] })}><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select></label>
    <label className="settings-row"><span><strong>Default reading mode</strong><small>Used for comics you have not started.</small></span><select value={preferences.mode} onChange={(e) => onChange({ ...preferences, mode: e.target.value as Preferences["mode"] })}><option value="paged">Paged</option><option value="scroll">Vertical scroll</option></select></label>
    <label className="settings-row"><span><strong>Reading time tracking</strong><small>Counts only focused, recently active reading time.</small></span><input type="checkbox" checked={preferences.readingTimeTracking} onChange={(e) => onChange({ ...preferences, readingTimeTracking: e.target.checked })} /></label>
    <label className="settings-row"><span><strong>Online series info</strong><small>Fetch ComicK and MyAnimeList info when a normal shelf opens.</small></span><input type="checkbox" checked={preferences.onlineMetadata} onChange={(e) => onChange({ ...preferences, onlineMetadata: e.target.checked })} /></label>
    <div className="settings-section"><h3>Private library</h3><p className="muted">Ctrl+H opens or locks it. On macOS, use Control+H or Command+Shift+H; Command+H remains the system shortcut.</p><button className="secondary" onClick={onVault}><Icon name="lock" size={17} />Open private library</button></div>
    <div className="notice">Ippo copies imports into its app-data folder. Private imports are encrypted managed copies, so after a successful import you may delete the original yourself. EPUB and DOCX can become novels when readable text is present; image-heavy files remain comics. Legacy DOC should be converted to PDF or DOCX first.</div>
    <p className="fine-print">Ippo to Read 0.3 &middot; Local-first &middot; No account or cloud service</p>
  </Modal>;
}


export function WatchedFoldersDialog({ folders, onClose, onAdd, onRemove, onSync }: {
  folders: WatchedFolder[]; onClose: () => void; onAdd: () => Promise<void>; onRemove: (id: string) => Promise<void>; onSync: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  return <Modal title="Watched library folders" onClose={() => { if (!busy) onClose(); }} wide>
    <p className="muted">Ippo scans these normal-library folders for new or changed comics and novels and copies them into managed storage automatically.</p>
    <div className="watch-list">
      {folders.length ? folders.map((folder) => <div className="watch-row" key={folder.id}><div><strong>{folder.path.split(/[\\/]/).filter(Boolean).at(-1) ?? folder.path}</strong><small title={folder.path}>{folder.path}</small></div><button className="text-button danger-text" disabled={busy} onClick={() => void run(() => onRemove(folder.id))}>Stop watching</button></div>) : <div className="notice">No watched folders yet.</div>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="button-row"><button className="primary" disabled={busy} onClick={() => void run(onAdd)}><Icon name="folder" size={16} />Add folder</button><button className="secondary" disabled={busy || !folders.length} onClick={() => void run(onSync)}>Scan now</button></div>
    <p className="fine-print">Watched folders are for the normal library only. Private comics and novels are never auto-discovered; add those manually so nothing sensitive is indexed from a folder path.</p>
  </Modal>;
}

export function RoadmapDialog({ onClose }: { onClose: () => void }) {
  const items = [
    { title: "Third-party library connections", description: "Connect Ippo with services such as ComicK, MyAnimeList and similar trackers so library progress and lists can be shared or synchronized." },
    { title: "Better metadata reading", description: "Read more embedded metadata, alternate titles, source information and format clues so comics, manhwa, manhua, webtoons and novels are organized more accurately." },
    { title: "External downloads straight into Ippo", description: "Let supported external downloads land directly in Ippo's managed library instead of requiring a separate download-and-import step." },
    { title: "Multiple UI layouts", description: "Offer different library and reader interface styles so people can choose a compact, visual, minimal or classic layout." },
    { title: "Android version", description: "Bring Ippo to Android with a touch-first reader and a library experience designed for phones and tablets." },
  ];
  return <Modal title="Possible future updates" onClose={onClose} wide>
    <p className="muted">Ideas currently planned or being considered for future versions of Ippo to Read. These are not available yet and may change as the app develops.</p>
    <div className="roadmap-list">
      {items.map((item) => <article className="roadmap-item" key={item.title}>
        <div className="roadmap-item-heading"><span className="roadmap-bang">!</span><h3>{item.title}</h3><span className="roadmap-status">Planned</span></div>
        <p>{item.description}</p>
      </article>)}
    </div>
    <p className="fine-print">This roadmap is informational only. It does not automatically download updates, connect accounts, or send library data anywhere.</p>
    <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
  </Modal>;
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    ["Left / Right arrows", "Turn pages using the chosen reading direction"],
    ["Space / Shift+Space", "Next / previous page, or scroll by a screen"],
    ["Space twice", "Next chapter or volume (280 ms window)"],
    ["Shift+Space twice", "Previous chapter or volume"],
    ["Ctrl/Cmd+O", "Import into the current Comics / Novels tab"], ["Ctrl/Cmd+Shift+O", "Add a watched normal-library folder"],
    ["Ctrl/Cmd+F", "Search the library"], ["Ctrl/Cmd+1 / 2", "Paged / vertical scroll mode"],
    ["R", "Switch left-to-right / right-to-left"], ["F", "Toggle fullscreen"],
    ["Space / Shift+Space (Novel)", "Scroll down / up by a screen"],
    ["Space twice / Shift+Space twice (Novel)", "Next / previous EPUB chapter"],
    ["Alt+Left / Alt+Right", "Previous / next chapter in Novel mode"],
    ["A (Novel)", "Open or close reading appearance settings"],
    ["Escape", "Close Novel settings first, then return to the shelf"],
    ["Ctrl+H", "Open or lock private library"], ["Cmd+Shift+H (Mac)", "Alternative private-library shortcut"],
    ["000000000000", "Type 12 zeros in the private passphrase field to open recovery: save an encrypted backup or erase/reset the private library"],
  ];
  return <Modal title="A little less clicking" onClose={onClose} wide><p className="muted">Reader shortcuts are paused while typing or while a dialog is open.</p><div className="shortcut-list">{rows.map(([key, action]) => <div key={key}><kbd>{key}</kbd><span>{action}</span></div>)}</div><p className="fine-print">Single Space waits briefly to distinguish it from a double tap. Hold-to-repeat is ignored for the chapter shortcut.</p></Modal>;
}

export function EditDialog({ book, onClose, onSave, onTransfer, onDelete }: {
  book: Book; onClose: () => void; onSave: (edit: EditBook) => Promise<void>; onTransfer: () => Promise<void>; onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(book.title); const [series, setSeries] = useState(book.series);
  const [volume, setVolume] = useState(book.volume?.toString() ?? ""); const [chapter, setChapter] = useState(book.chapter?.toString() ?? "");
  const [author, setAuthor] = useState(book.metadata.author); const [publisher, setPublisher] = useState(book.metadata.publisher);
  const [language, setLanguage] = useState(book.metadata.language); const [genres, setGenres] = useState(book.metadata.genres.join(", "));
  const [description, setDescription] = useState(book.metadata.description); const [sourceUrl, setSourceUrl] = useState(book.metadata.sourceUrl);
  const [medium, setMedium] = useState(book.kind === "novel" ? "novel" : book.metadata.medium);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [confirmDelete, setConfirmDelete] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  return <Modal title={book.kind === "novel" ? "Edit book metadata" : "Organize this comic"} onClose={() => { if (!busy) onClose(); }} wide>
    <form onSubmit={(e) => { e.preventDefault(); void run(() => onSave({ title, series, volume: volume === "" ? null : Number(volume), chapter: chapter === "" ? null : Number(chapter), author, publisher, language, genres: genres.split(",").map((x) => x.trim()).filter(Boolean), description, sourceUrl, medium: medium as EditBook["medium"] })); }}>
      <div className="two-fields"><label className="field">Series / shelf<input autoFocus required maxLength={200} value={series} onChange={(e) => setSeries(e.target.value)} /></label><label className="field">Title<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label></div>
      <div className="two-fields"><label className="field">Volume<input type="number" min="0" max="1000000" step="any" value={volume} onChange={(e) => setVolume(e.target.value)} /></label><label className="field">Chapter<input type="number" min="0" max="1000000" step="any" value={chapter} onChange={(e) => setChapter(e.target.value)} /></label></div>
      <div className="two-fields"><label className="field">Author<input maxLength={300} value={author} onChange={(e) => setAuthor(e.target.value)} /></label><label className="field">Publisher<input maxLength={300} value={publisher} onChange={(e) => setPublisher(e.target.value)} /></label></div>
      <div className="two-fields"><label className="field">Type<select value={medium} disabled={book.kind === "novel"} onChange={(e) => setMedium(e.target.value as typeof medium)}><option value="unknown">Unclassified</option><option value="comic">Comic</option><option value="manga">Manga</option><option value="manhwa">Manhwa</option><option value="manhua">Manhua</option><option value="webtoon">Webtoon</option>{book.kind === "novel" && <option value="novel">Novel</option>}</select></label><label className="field">Language<input maxLength={80} placeholder="en, ja, ko..." value={language} onChange={(e) => setLanguage(e.target.value)} /></label></div>
      <label className="field">Genres<input maxLength={500} placeholder="Action, Drama, Sports" value={genres} onChange={(e) => setGenres(e.target.value)} /></label>
      <label className="field">Description<textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="field">Official / source URL<input maxLength={1200} placeholder="https://..." value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} /></label>
      <p className="fine-print">Detected metadata: {book.metadata.metadataSource || "filename only"}. Manual changes stay inside Ippo and do not rename your original file.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary full" disabled={busy} type="submit">{busy ? "Working..." : "Save metadata"}</button>
    </form>
    <div className="settings-section"><button className="secondary full" disabled={busy} onClick={() => void run(onTransfer)}><Icon name="lock" size={16} />{book.isPrivate ? "Move to normal library" : "Move to private library"}</button><p className="fine-print">Moving encrypts or decrypts the managed copy. Originals and old backups are unchanged; secure deletion of old disk data is not guaranteed.</p></div>
    {confirmDelete ? <div className="notice danger-notice"><p>Remove this managed item and its bookmark? Your original will remain untouched.</p><div className="button-row"><button className="danger" disabled={busy} onClick={() => void run(onDelete)}>Yes, remove</button><button className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button></div></div> : <button className="text-button danger-text" disabled={busy} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} />Remove from library</button>}
  </Modal>;
}

export function ImportDialog({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const novels = report.imported.filter((book) => book.kind === "novel").length;
  const comics = report.imported.length - novels;
  const parts = [comics ? `${comics} comic ${comics === 1 ? "item" : "items"}` : "", novels ? `${novels} ${novels === 1 ? "novel" : "novels"}` : ""].filter(Boolean);
  return <Modal title="Import complete" onClose={onClose}><p>{parts.length ? `${parts.join(" and ")} ready.` : "No new items were added."} Comics are grouped into shelves; novels appear in the Novels tab.</p>
    {report.warnings.map((message, i) => <p className="notice" key={i}>{message}</p>)}
    {report.errors.length > 0 && <><h3>Files that could not be imported</h3><div className="import-errors">{report.errors.map((message, i) => <p key={i}>{message}</p>)}</div></>}
    <button className="primary full" onClick={onClose}>Back to my library</button></Modal>;
}


export function ReadingStatsDialog({ books, onClose }: { books: Book[]; onClose: () => void }) {
  const comics = books.filter((b) => b.kind !== "novel");
  const novels = books.filter((b) => b.kind === "novel");
  const total = (items: Book[]) => items.reduce((n, b) => n + (b.readingSeconds || 0), 0);
  const ranked = [...books].filter((b) => b.readingSeconds > 0).sort((a,b) => b.readingSeconds - a.readingSeconds).slice(0,5);
  return <Modal title="Reading time" onClose={onClose} wide>
    <p className="dialog-lead">Ippo counts only active, focused reading time. Idle, minimized and unfocused time is ignored.</p>
    <div className="stats-grid">
      <div><span>Total</span><strong>{formatReadingTime(total(books))}</strong><small>{books.length} items in this library</small></div>
      <div><span>Comics</span><strong>{formatReadingTime(total(comics))}</strong><small>{comics.length} chapters / volumes</small></div>
      <div><span>Novels</span><strong>{formatReadingTime(total(novels))}</strong><small>{novels.length} books</small></div>
    </div>
    <div className="section-heading compact-heading"><h3>Most read</h3><span>All time on this device</span></div>
    {ranked.length ? <div className="stats-list">{ranked.map((book, index) => <div key={book.id}><span>{index + 1}</span><div><strong>{book.kind === "novel" ? book.title : book.series}</strong><small>{book.kind === "novel" ? (book.metadata.author || "Novel") : book.title}</small></div><b>{formatReadingTime(book.readingSeconds)}</b></div>)}</div> : <p className="muted">Start reading and your active time will appear here automatically.</p>}
    <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
  </Modal>;
}
