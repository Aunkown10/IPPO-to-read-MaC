import { useEffect, useRef, useState } from "react";
import type { Book, ClassificationCandidate, ClassificationDecision, ComicLayout, Medium } from "../types";
import { api } from "../lib/api";
import { errorText } from "../lib/logic";
import { classifyLocal, classifyWithSources, chooseCandidate, COMIC_TYPES, layoutLabel, pinType, preferredQuery, typeLabel } from "../lib/classification";
import { Modal } from "./Modal";

export function ClassificationPanel({ books, onlineMetadata, onClose, onChanged }: {
  books: Book[]; onlineMetadata: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [working, setWorking] = useState(books);
  const [decision, setDecision] = useState<ClassificationDecision>(books[0].metadata.classification ?? classifyLocal(books));
  const [candidates, setCandidates] = useState<ClassificationCandidate[]>([]);
  const [query, setQuery] = useState(preferredQuery(books));
  const [medium, setMedium] = useState<Medium>(decision.medium === "webtoon" ? "unknown" : decision.medium);
  const [layout, setLayout] = useState<ComicLayout>(decision.layout);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [error, setError] = useState(""); const mounted = useRef(true); const inFlight = useRef(false);
  const privateView = books[0].isPrivate;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const show = (d: ClassificationDecision) => { setDecision(d); setMedium(d.medium); setLayout(d.layout); };
  async function perform(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const unpinnedBooks = (input: Book[]) => input.map((b) => ({ ...b, metadata: { ...b.metadata, classification: b.metadata.classification?.locked ? null : b.metadata.classification } }));
  async function search() {
    if (privateView || !onlineMetadata) return;
    await perform(async () => {
      const latest = await api.classificationBooks(books[0].id);
      if (!mounted.current) return;
      setWorking(latest);
      const lookup = await api.classificationSources(books[0].id, query);
      if (!mounted.current) return;
      // Looking again doesn't silently replace a pinned choice. The user explicitly applies it.
      const result = classifyWithSources(unpinnedBooks(latest), lookup, query);
      show(result.decision); setCandidates(result.candidates);
      setMessage("Search complete. Review the evidence; nothing is changed until you apply a result.");
    });
  }
  async function save(value: ClassificationDecision) {
    await perform(async () => {
      await api.applyClassification(books[0].id, value); await onChanged();
      if (!mounted.current) return;
      show(value); setMessage(`Saved for every chapter in this shelf. ${value.locked ? "Your choice is pinned and future chapters inherit it." : "Bookmarks, covers and files are unchanged."}`);
    });
  }
  return <Modal title={`Classification: ${books[0].series}`} onClose={onClose} wide>
    <div className="classification-panel">
      <p>Origin/type and reading format are separate. A Korean long-strip work can be <strong>Manhwa</strong> and <strong>Webtoon / long-strip</strong> at the same time.</p>
      <div className="classification-summary" role="status"><strong>{typeLabel(decision.medium)}</strong><span>{layoutLabel(decision.layout)}</span><small>{decision.locked ? "Pinned by you" : decision.status} &middot; {decision.source}</small></div>
      {decision.evidence.length > 0 && <details open><summary>Evidence used</summary><ul>{decision.evidence.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
      {decision.warnings.length > 0 && <div className="notice"><strong>Needs attention</strong><ul>{decision.warnings.map((line, i) => <li key={i}>{line}</li>)}</ul></div>}
      <p className="fine-print">Translated text and sound effects, a scanlation website, color, and scroll mode are not proof of country of origin. Ippo does not run OCR or upload your pages.</p>
      <div className="button-row">
        <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
          const latest = await api.classificationBooks(books[0].id); if (!mounted.current) return;
          setWorking(latest); show(classifyLocal(unpinnedBooks(latest))); setCandidates([]);
          setMessage("Local metadata checked. Original files linked to watched folders are re-read when available.");
        })}>Check local metadata</button>
        <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
          const latest = await api.rereadComicMetadata(books[0].id); if (!latest || !mounted.current) return;
          setWorking(latest); show(classifyLocal(unpinnedBooks(latest))); await onChanged();
          setMessage("ComicInfo.xml read from the selected archive. No duplicate chapter was imported.");
        })}>Read ComicInfo from original file...</button>
      </div>
      <p className="fine-print">For the original-file option, choose a CBZ/ZIP chapter from this same series. Older Ippo versions did not retain all embedded fields; an image-only archive has no metadata to recover.</p>
      {!privateView && <form onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <label className="field">Search title or known alternate title<input maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <button className="secondary" disabled={busy || !onlineMetadata || !query.trim()}>{busy ? "Checking..." : "Search catalogs"}</button>
        <p className="fine-print">Sources: MyAnimeList via Jikan, MangaDex, and AniList. Only the title and embedded catalog IDs are queried. {onlineMetadata ? "Requires a working connection to those services." : "Online series info is turned off in Settings."}</p>
      </form>}
      {privateView && <p className="fine-print">Private library: local evidence and manual selection only. No network lookups.</p>}
      {candidates.length > 0 && <section><h3>Catalog matches &amp; suggestions</h3><p className="fine-print">Select only the entry for this actual work, not an adaptation, sequel or novel with a similar title.</p>
        <div className="classification-candidates">{candidates.map((c) => <article key={c.id}>
          <strong>{c.title}</strong><small>{c.provider} &middot; {typeLabel(c.medium)} &middot; {c.match === "possible" ? "Needs your confirmation" : "Title/ID matched"}</small>
          {c.aliases.length > 1 && <span>{c.aliases.slice(0, 4).join(" / ")}</span>}
          <small>{c.url}</small><button className="secondary" disabled={busy || c.medium === "unknown"} onClick={() => void save(chooseCandidate(c, classifyLocal(working)))}>This is the correct comic</button>
        </article>)}</div>
      </section>}
      {decision.status === "confirmed" && !decision.locked && <button className="primary" disabled={busy} onClick={() => void save(decision)}>Apply this classification to the shelf</button>}
      <section className="classification-manual"><h3>Set the correct type yourself</h3><p>Applies to every existing chapter and is remembered for future chapters in this shelf. Automatic checks will not overwrite a pinned choice.</p>
        <div className="two-fields"><label className="field">Origin / type<select value={medium} onChange={(e) => setMedium(e.target.value as Medium)}>{COMIC_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}</select></label>
          <label className="field">Presentation<select value={layout} onChange={(e) => setLayout(e.target.value as ComicLayout)}>{(["unknown", "paged", "longstrip"] as const).map((v) => <option key={v} value={v}>{layoutLabel(v)}</option>)}</select></label></div>
        <button className="primary" disabled={busy} onClick={() => void save(pinType(medium, layout, decision))}>Save type for this entire comic</button>
      </section>
      {busy && <p role="status">Checking metadata. Individual online services may take several seconds.</p>}
      {error && <p className="notice error-notice" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
    </div>
  </Modal>;
}
