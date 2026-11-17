import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../lib/api";
import type { Book } from "../types";
import { Icon } from "./Icon";

export function Cover({ book, compact = false }: { book: Book; compact?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !book.hasCover) return;
    let active = true; let owned: string | undefined;
    void api.readCover(book.id).then((blob) => {
      if (!active) return;
      owned = URL.createObjectURL(blob); setUrl(owned);
    }).catch(() => { /* A readable placeholder remains if a cover is missing or the vault locks. */ });
    return () => { active = false; if (owned) URL.revokeObjectURL(owned); };
  }, [visible, book.id, book.hasCover]);
  const hue = [...book.series].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  const coverlessNovel = (book.kind === "novel" || book.metadata.medium === "novel") && !url;
  return <div ref={root} className={`cover ${compact ? "compact" : ""}${coverlessNovel ? " novel-blank-cover" : ""}`} style={{ "--cover-hue": hue } as CSSProperties}>
    <div className={`cover-placeholder${coverlessNovel ? " novel-title-cover" : ""}`}>{coverlessNovel ? <><strong>{book.title || book.series || "Untitled"}</strong>{book.metadata.author && <small>{book.metadata.author}</small>}</> : <><Icon name="book" size={compact ? 24 : 38} /><strong>{book.series}</strong><small>{book.format}</small></>}</div>
    {url && <img src={url} alt={`${book.series}, ${book.title} cover`} draggable={false} onError={() => setUrl(undefined)} />}
    {!compact && <span className="cover-spine" />}
  </div>;
}

export function ShelfCover({ series, fallback, privateView, refreshToken = 0, compact = false }: {
  series: string; fallback: Book; privateView: boolean; refreshToken?: number; compact?: boolean;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true; let owned: string | undefined;
    setUrl(undefined);
    void api.readShelfCover(series, privateView).then((blob) => {
      if (!active) return;
      owned = URL.createObjectURL(blob); setUrl(owned);
    }).catch(() => { if (active) setUrl(undefined); });
    return () => { active = false; if (owned) URL.revokeObjectURL(owned); };
  }, [series, privateView, refreshToken]);
  if (!url) return <Cover book={fallback} compact={compact} />;
  return <div className={`cover shelf-custom-cover ${compact ? "compact" : ""}`}>
    <img src={url} alt={`${series} shelf image`} draggable={false} onError={() => setUrl(undefined)} />
    {!compact && <span className="cover-spine" />}
  </div>;
}
