import type { Book } from "../types";
import { isBookCompleted, progressPercent, relativeTime } from "../lib/logic";
import { formatReadingTime } from "../lib/readingTime";
import { Cover } from "./Cover";
import { Icon } from "./Icon";

export function NovelLibrary({ books, query, onRead, onEdit, onImport }: {
  books: Book[]; query: string; onRead: (book: Book) => void; onEdit: (book: Book) => void; onImport: () => void;
}) {
  const filtered = books.filter((book) => `${book.title} ${book.series} ${book.metadata.author}`.toLowerCase().includes(query.toLowerCase()));
  const recent = [...filtered].filter((b) => b.lastRead && !isBookCompleted(b)).sort((a,b) => b.lastRead - a.lastRead)[0];
  const totalSeconds = books.reduce((sum, b) => sum + (b.readingSeconds || 0), 0);
  return <div className="novel-home enter">
    <div className="novel-home-heading"><div><span className="eyebrow">A QUIETER SHELF</span><h1>Your novels.</h1><p>Pick up where you left off. Everything else can wait.</p></div><div className="novel-stat"><strong>{books.length}</strong><span>{books.length === 1 ? "book" : "books"}</span><small>{formatReadingTime(totalSeconds)} read</small></div></div>
    {recent && !query && <section className="novel-continue"><div className="novel-continue-cover"><Cover book={recent} /></div><div><span className="eyebrow">CONTINUE READING</span><h2>{recent.title}</h2><p>{recent.metadata.author || recent.series}</p><p>Chapter {recent.progress.page + 1} · {Math.round(progressPercent(recent.progress, recent.pages.length, true))}% · {relativeTime(recent.lastRead)}</p><button className="primary" onClick={() => onRead(recent)}><Icon name="book" size={17} />Continue reading</button></div></section>}
    <section><div className="section-heading"><h2>{query ? "Search results" : "Bookshelf"}</h2><span>{filtered.length} {filtered.length === 1 ? "book" : "books"}</span></div>
      {filtered.length ? <div className="novel-grid">{filtered.map((book) => <article className={`novel-card${isBookCompleted(book) ? " completed" : ""}`} key={book.id}>
        <button className="novel-card-open" onClick={() => onRead(book)}><Cover book={book} /><strong>{book.title}</strong><span>{book.metadata.author || book.series}</span><small>{book.lastRead ? `${Math.round(progressPercent(book.progress, book.pages.length, true))}% read` : book.metadata.publisher || book.format}</small></button>
        <button className="novel-card-more" aria-label={`Edit ${book.title}`} onClick={() => onEdit(book)}><Icon name="more" size={17} /></button>
      </article>)}</div> : <div className="empty-state"><Icon name="book" size={44}/><h2>{query ? "No matching books." : "Your bookshelf is waiting."}</h2><p>{query ? "Try another title or author." : "Import EPUB, DOCX or TXT novels. Ippo keeps your reading position automatically."}</p>{!query && <button className="primary" onClick={onImport}><Icon name="plus" size={16}/>Import novels</button>}</div>}
    </section>
  </div>;
}
