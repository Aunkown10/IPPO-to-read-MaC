import type { Book, EditBook, Progress } from "../types";
const names = ["The Quiet Planet", "Paper Cities", "After the Rain", "A Thousand Steps", "Moonlight Express", "Small Hours"];
const inks = ["#4f6659", "#a65c41", "#384761", "#c19649", "#716482", "#637f86"];
const KEY = "ippo-demo-progress-v1";
const seed: Book[] = names.flatMap((series, s) => Array.from({ length: s === 0 ? 3 : 2 }, (_, v) => ({
  id: `demo-${s}-${v}`, series, title: `Volume ${v + 1}`, volume: v + 1, chapter: null,
  kind: "images" as const, format: "DEMO", pages: Array.from({ length: 8 }, () => ({ width: 760, height: 1080, mime: "image/svg+xml" })),
  hasCover: true, isPrivate: false, addedAt: 1700000000000 + s * 1000 + v,
  metadata: { author: "Ippo Sample Studio", publisher: "", language: "en", genres: ["Sample"], description: "Original sample content for the browser preview.", sourceUrl: "", medium: s === 1 ? "manga" as const : "comic" as const, metadataSource: "Demo" },
  readingSeconds: s < 3 ? (s + 1) * 900 : 0, wordCount: 0,
  lastRead: s < 3 && v === 0 ? Date.now() - (s + 1) * 7200000 : 0,
  progress: { page: s < 3 ? 2 + s : 0, offset: 0, mode: "paged" as const, direction: s === 1 ? "rtl" as const : "ltr" as const, zoom: 1 },
})));
let books = structuredClone(seed);
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Book[] | null;
  if (Array.isArray(saved) && saved.every((b) => typeof b.id === "string" && b.id.startsWith("demo-"))) books = saved;
} catch { /* Corrupt preview state is ignored; this is not the desktop database. */ }
function persist(): void { localStorage.setItem(KEY, JSON.stringify(books)); }
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const bytes = (svg: string): ArrayBuffer => new TextEncoder().encode(svg).buffer as ArrayBuffer;
export function demoList(): Book[] { return structuredClone(books); }
export function demoSave(id: string, progress: Progress): void {
  books = books.map((b) => b.id === id ? { ...b, progress, lastRead: Date.now() } : b); persist();
}
export function demoEdit(id: string, edit: EditBook): Book {
  books = books.map((b) => b.id === id ? {
    ...b, title: edit.title, series: edit.series, volume: edit.volume, chapter: edit.chapter,
    metadata: { ...b.metadata, author: edit.author, publisher: edit.publisher, language: edit.language, genres: edit.genres, description: edit.description, sourceUrl: edit.sourceUrl, medium: b.kind === "novel" ? "novel" : edit.medium },
  } : b);
  persist(); return books.find((b) => b.id === id)!;
}
export function demoRemove(id: string): void { books = books.filter((b) => b.id !== id); persist(); }
export function demoCover(id: string): ArrayBuffer {
  const book = books.find((b) => b.id === id)!;
  const s = Number(id.split("-")[1]) || 0;
  const ink = inks[s % inks.length];
  const words = book.series.split(" ");
  const title = words.map((word, i) => `<text x="52" y="${115 + i * 49}" font-size="43" font-weight="700" fill="#fbf7ee">${escapeXml(word)}</text>`).join("");
  return bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="594" viewBox="0 0 420 594"><rect width="420" height="594" fill="${ink}"/><g opacity=".13" stroke="#fff" fill="none"><path d="M0 450L420 180M0 490L420 220M0 530L420 260M0 570L420 300" stroke-width="2"/><circle cx="300" cy="396" r="147"/><circle cx="300" cy="396" r="121"/></g><circle cx="260" cy="400" r="81" fill="#f2dfb5" opacity=".92"/><path d="M0 500l125-167 147 167 148-233v327H0" fill="#192d2a" opacity=".52"/><path d="M230 594l52-260 50 260" fill="#fbf7ee" opacity=".72"/><g font-family="Arial,sans-serif"><text x="52" y="47" font-size="11" letter-spacing="4" fill="#fbf7ee">IPPO ORIGINAL SAMPLE</text>${title}<text x="52" y="554" font-size="14" letter-spacing="3" fill="#fbf7ee">VOLUME ${book.volume ?? 1}</text></g></svg>`);
}
export function demoPage(id: string, page: number): ArrayBuffer {
  if (page === 0) return demoCover(id);
  const b = books.find((book) => book.id === id)!;
  const ink = inks[(Number(id.split("-")[1]) || 0) % inks.length];
  return bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="1080" viewBox="0 0 760 1080"><rect width="760" height="1080" fill="#f5f0e5"/><g stroke="#233a31" stroke-width="4"><rect x="35" y="70" width="690" height="330" fill="${ink}"/><rect x="35" y="420" width="333" height="360" fill="#d7decc"/><rect x="388" y="420" width="337" height="360" fill="#dbb895"/><rect x="35" y="800" width="690" height="210" fill="#b6c9bd"/></g><circle cx="560" cy="180" r="68" fill="#f3dfb3"/><path d="M37 390L210 180l145 160 121-89 247 139" fill="#293f35"/><path d="M45 768L162 510l110 258M400 769l146-276 165 276" fill="${ink}" opacity=".75"/><rect x="74" y="101" rx="25" width="300" height="73" fill="white"/><rect x="421" y="448" rx="25" width="259" height="73" fill="white"/><g font-family="Arial,sans-serif" fill="#233a31" text-anchor="middle"><text x="380" y="39" font-size="18">${escapeXml(b.series)} / ${escapeXml(b.title)}</text><text x="223" y="145" font-size="18">Every story starts somewhere.</text><text x="550" y="491" font-size="18">Just one more page.</text><text x="380" y="884" font-size="27">Your direction. Your pace.</text><text x="380" y="931" font-size="18">Sample page - import your comics in the desktop app.</text><text x="380" y="1052" font-size="20">${page + 1}</text></g></svg>`);
}
