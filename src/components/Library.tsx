import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Book, SeriesReviewBundle, Shelf } from "../types";
import { errorText, isBookCompleted, progressPercent, relativeTime } from "../lib/logic";
import { classifyLocal, layoutLabel, typeLabel } from "../lib/classification";
import { Cover, ShelfCover } from "./Cover";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { formatReadingTime } from "../lib/readingTime";

function ProgressBar({ value }: { value: number }) {
  return <span className="progress-track" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span style={{ width: `${value}%` }} /></span>;
}
function shelfItemsLabel(books: readonly Book[]): string {
  const allChapters = books.length > 0 && books.every((book) => book.chapter !== null && book.volume === null);
  const allVolumes = books.length > 0 && books.every((book) => book.volume !== null && book.chapter === null);
  if (allChapters) return `${books.length} ${books.length === 1 ? "chapter" : "chapters"}`;
  if (allVolumes) return `${books.length} ${books.length === 1 ? "volume" : "volumes"}`;
  return `${books.length} ${books.length === 1 ? "chapter / volume" : "chapters / volumes"}`;
}
export function ContinueCard({ book, onRead }: { book: Book; onRead: (book: Book) => void }) {
  const progress = progressPercent(book.progress, book.pages.length, !!book.lastRead);
  return <button className="continue-card" onClick={() => onRead(book)}>
    <Cover book={book} compact />
    <span className="continue-copy"><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><strong>{book.series}</strong><span>{book.title} &middot; {Math.round(progress)}%</span><ProgressBar value={progress} /></span>
    <span className="play-circle"><Icon name="play" size={18} /></span>
  </button>;
}
export function ShelfCard({ shelf, onOpen, onRead, onCoverChange, onCoverReset, privateView, coverEpoch, onClassify }: {
  shelf: Shelf;
  onOpen: (key: string) => void;
  onClassify: (book: Book) => void;
  onRead: (book: Book) => void;
  onCoverChange: (series: string) => void;
  onCoverReset: (series: string) => void;
  privateView: boolean;
  coverEpoch: number;
}) {
  const completed = shelf.books.length > 0 && shelf.books.every(isBookCompleted);
  const items = shelfItemsLabel(shelf.books);
  const classification = shelf.books[0].metadata.classification ?? classifyLocal(shelf.books);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", keyboard);
    };
  }, [menuOpen]);

  const openContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuOpen(true);
  };
  return <article ref={cardRef} className={`shelf-card${completed ? " completed" : ""}${menuOpen ? " menu-open" : ""}`} onContextMenu={openContextMenu}>
    <button className="shelf-open" onClick={() => onOpen(shelf.key)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`${shelf.title}, ${items}. Click to open. Right-click for options.`}>
      <div className="book-stack"><span className="stack-layer layer-two" /><span className="stack-layer layer-one" /><ShelfCover series={shelf.title} fallback={shelf.books[0]} privateView={privateView} refreshToken={coverEpoch} /></div>
      <strong>{shelf.title}</strong><span>{items}</span><small className="classification-badge">{typeLabel(classification.medium)}{classification.layout === "longstrip" ? " / Long-strip" : ""}</small>
    </button>
    {menuOpen && <div className="shelf-quick-menu" role="menu" aria-label={`${shelf.title} options`}>
      <button role="menuitem" onClick={() => { setMenuOpen(false); onOpen(shelf.key); }}><Icon name="grid" size={15} /><span><strong>Open comic</strong><small>View chapters and volumes</small></span></button>
      <button role="menuitem" onClick={() => { setMenuOpen(false); onRead(shelf.resume); }}><Icon name={shelf.lastRead ? "play" : "book"} size={15} /><span><strong>{completed ? "Read again" : shelf.lastRead ? "Continue reading" : "Start reading"}</strong><small>{shelf.resume.title}</small></span></button>
      <button role="menuitem" onClick={() => { setMenuOpen(false); onClassify(shelf.books[0]); }}><Icon name="search" size={15} /><span><strong>Classification / fix type</strong><small>Evidence, catalog matches and shelf-wide type</small></span></button>
      <span className="shelf-menu-divider" />
      <button role="menuitem" onClick={() => { setMenuOpen(false); onCoverChange(shelf.title); }}><Icon name="image" size={15} /><span><strong>Add comic cover</strong><small>Choose your own volume-style cover</small></span></button>
      <button role="menuitem" onClick={() => { setMenuOpen(false); onCoverReset(shelf.title); }}><Icon name="back" size={15} /><span><strong>Use chapter cover</strong><small>Restore the automatic cover</small></span></button>
    </div>}
    {completed ? <div className="shelf-completed"><Icon name="check" size={14} /><span>Completed</span></div> :
      <button className={`shelf-resume ${shelf.lastRead ? "has-progress" : ""}`} onClick={() => onRead(shelf.resume)}>
        <Icon name={shelf.lastRead ? "play" : "book"} size={14} />
        <span>{shelf.lastRead ? `${shelf.resume.title} - ${Math.round(progressPercent(shelf.resume.progress, shelf.resume.pages.length))}%` : "Start reading"}</span>
      </button>}
  </article>;
}
export function EmptyLibrary({ onImport, onFolder, searching, privateView = false }: { onImport: () => void; onFolder?: () => void; searching: boolean; privateView?: boolean }) {
  return <div className="empty-state">
    <div className="empty-books"><i /><i /><i /></div>
    <span className="eyebrow">YOUR STORIES BELONG HERE</span>
    <h2>{searching ? "No matching stories." : "A shelf for every story."}</h2>
    <p>{searching ? "Try another title or clear your search." : "Bring your comics. Chapters and volumes with the same series name are grouped into one shelf automatically."}</p>
    {!searching && <><div className="button-row"><button className="primary" onClick={onImport}><Icon name="plus" />Import comics</button>{onFolder && !privateView && <button className="secondary" onClick={onFolder}><Icon name="folder" />Watch comic folder</button>}</div><small>{privateView ? "Private imports are copied into encrypted Ippo storage one batch at a time." : "ZIP / CBZ / PDF / EPUB / DOCX images / JPG / PNG / WebP / GIF"}</small></>}
  </div>;
}

function SeriesInfo({ shelf, privateView, onlineMetadata, onClassify }: { shelf: Shelf; privateView: boolean; onlineMetadata: boolean; onClassify: () => void }) {
  const source = shelf.books.find((b) => b.metadata.metadataSource || b.metadata.author || b.metadata.publisher || b.metadata.description) ?? shelf.books[0];
  const meta = source.metadata;
  const classification = meta.classification ?? classifyLocal(shelf.books);
  const [reviews, setReviews] = useState<SeriesReviewBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const cacheKey = `ippo:series-info:v2:${shelf.key}`;
  const load = async (force = false) => {
    if (privateView || !onlineMetadata) return;
    setReviewError("");
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as { fetchedAt?: number; bundle?: SeriesReviewBundle } | null;
        if (cached?.bundle) {
          setReviews(cached.bundle);
          if (Date.now() - (cached.fetchedAt ?? 0) < 7 * 24 * 60 * 60 * 1000) return;
        }
      } catch { /* cache corruption should never block reading */ }
    }
    setLoading(true);
    try {
      const bundle = await api.seriesReviews(shelf.title, meta);
      setReviews(bundle);
      try { localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), bundle })); } catch { /* optional cache */ }
    } catch (e) { setReviewError(errorText(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    setReviews(null);
    if (!privateView && onlineMetadata) void load(false);
    // Each shelf has its own seven-day cache; private shelves never perform online lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf.key, privateView, onlineMetadata]);
  const hasLocal = meta.author || meta.publisher || meta.language || meta.genres.length || meta.description || meta.metadataSource;
  return <section className="series-info">
    <div className="section-heading"><h2>Series info</h2><span>{meta.metadataSource ? `Read from ${meta.metadataSource}` : "Filename metadata"}</span></div>
    {hasLocal ? <div className="metadata-grid">
      {meta.author && <div><span>Author</span><strong>{meta.author}</strong></div>}
      {meta.publisher && <div><span>Publisher</span><strong>{meta.publisher}</strong></div>}
      {meta.language && <div><span>Language</span><strong>{meta.language}</strong></div>}
      <div><span>Type</span><strong>{typeLabel(classification.medium)}</strong></div>
      {meta.genres.length > 0 && <div className="wide"><span>Genres</span><strong>{meta.genres.join(", ")}</strong></div>}
      {meta.description && <div className="wide"><span>Description</span><p>{meta.description}</p></div>}
    </div> : <p className="muted">This file did not include rich metadata. You can add it from the chapter menu.</p>}
    <div className="classification-summary"><strong>{typeLabel(classification.medium)}</strong><span>{layoutLabel(classification.layout)}</span><small>{classification.source}</small><button className="secondary" onClick={onClassify}>Classification / fix type</button></div>
    <div className="reading-time-line"><Icon name="book" size={15}/><span>{formatReadingTime(shelf.books.reduce((n,b)=>n+(b.readingSeconds||0),0))} total reading time</span></div>
    {!privateView && <div className="reviews-block"><div className="section-heading compact-heading"><h3>Reviews &amp; sources</h3><button className="text-button" disabled={loading || !onlineMetadata} onClick={() => void load(true)}>{loading ? "Refreshing..." : "Refresh online info"}</button></div>
      {!onlineMetadata ? <p className="muted">Online metadata is turned off in Settings.</p> : reviewError ? <p className="notice">{reviewError}</p> : reviews?.cards.length ? <div className="review-grid">{reviews.cards.slice(0,3).map((card) => <article className="review-card" key={card.provider}><span>{card.provider}</span><h4>{card.title}</h4>{card.score != null && <strong>{card.score.toFixed(1)} / 10</strong>}<p>{card.body || "No review text was available from this source."}</p>{card.url && <small>{card.url}</small>}</article>)}</div> : loading ? <div className="muted">Checking ComicK, MyAnimeList and publisher metadata...</div> : null}
      {reviews?.warnings.length ? <p className="fine-print">{reviews.warnings.join(" · ")}</p> : null}
      {reviews?.cards.length ? <p className="fine-print">Online info is cached on this device for seven days and remains visible offline after the first successful lookup.</p> : null}
    </div>}
  </section>;
}
export function ShelfDetail({ shelf, onBack, onRead, onEdit, privateView, coverEpoch, onCoverChange, onCoverReset, onlineMetadata, onClassify }: {
  shelf: Shelf; onBack: () => void; onRead: (book: Book) => void; onEdit: (book: Book) => void;
  privateView: boolean; coverEpoch: number; onCoverChange: () => void; onCoverReset: () => void; onlineMetadata: boolean; onClassify: () => void;
}) {
  const shelfCompleted = shelf.books.length > 0 && shelf.books.every(isBookCompleted);
  return <div className="shelf-detail enter">
    <button className="text-button back-link" onClick={onBack}><Icon name="back" size={17} />All shelves</button>
    <section className={`shelf-hero${shelfCompleted ? " completed" : ""}`}>
      <div className="shelf-hero-cover"><ShelfCover series={shelf.title} fallback={shelf.books[0]} privateView={privateView} refreshToken={coverEpoch} />
        <button className="shelf-image-action" onClick={onCoverChange}><Icon name="image" size={15} />Add / change comic cover</button>
      </div>
      <div>
      <span className="eyebrow">YOUR COLLECTION</span><h1>{shelf.title}</h1>
      <p>{shelfItemsLabel(shelf.books)} &middot; Organized in reading order</p>
      <button className="text-button reset-cover" onClick={onCoverReset}>Use chapter cover instead</button>
      {shelfCompleted ? <p className="completion-note"><Icon name="check" size={15} />Completed</p> : shelf.lastRead > 0 && <p className="last-read">Last opened: <strong>{shelf.resume.title}</strong><br /><span>Page {shelf.resume.progress.page + 1} &middot; {relativeTime(shelf.lastRead)}</span></p>}
      <button className={shelfCompleted ? "secondary" : "primary"} onClick={() => onRead(shelf.resume)}><Icon name={shelfCompleted ? "book" : "play"} size={18} />{shelfCompleted ? "Read again" : shelf.lastRead ? "Continue reading" : "Start reading"}</button>
    </div></section>
    <SeriesInfo shelf={shelf} privateView={privateView} onlineMetadata={onlineMetadata} onClassify={onClassify} />
    <div className="section-heading"><h2>Chapters &amp; volumes</h2><span>{shelfItemsLabel(shelf.books)} in this shelf</span></div>
    <div className="chapter-list">{shelf.books.map((book, index) => {
      const percentage = progressPercent(book.progress, book.pages.length, !!book.lastRead);
      const completed = isBookCompleted(book);
      const recent = !completed && book.id === shelf.resume.id && !!shelf.lastRead;
      return <div className={`chapter-row${recent ? " current" : ""}${completed ? " completed" : ""}`} key={book.id}>
        <span className="chapter-number">{String(index + 1).padStart(2, "0")}</span>
        <button className="chapter-open" onClick={() => onRead(book)}><Cover book={book} compact />
          <span className="chapter-copy"><strong>{book.title}{recent && <em>Last read</em>}{completed && <em className="completed-badge">Completed</em>}</strong><span>{book.format} &middot; {book.pages.length ? `${book.pages.length} pages` : "Page count on first open"}</span></span>
        </button>
        <div className="chapter-progress"><span>{completed ? "Completed" : book.lastRead ? `${Math.round(percentage)}% read` : "Not started"}</span><ProgressBar value={percentage} /></div>
        <button className="icon-button" aria-label={`Edit ${book.title}`} title="Edit, move or remove chapter / volume" onClick={() => onEdit(book)}><Icon name="more" /></button>
      </div>;
    })}</div>
  </div>;
}
