import type { Book, BookMetadata, ClassificationCandidate, ClassificationDecision, ClassificationLookup, ClassificationProviderResponse, ComicLayout, Medium, PageSize } from "../types.ts";

export const CLASSIFIER_VERSION = 2;
export const COMIC_TYPES = ["unknown", "manga", "manhwa", "manhua", "comic"] as const;
export const typeLabel = (medium: Medium): string => medium === "unknown" ? "Unclassified" : medium[0].toUpperCase() + medium.slice(1);
export const layoutLabel = (layout: ComicLayout): string => layout === "longstrip" ? "Webtoon / long-strip" : layout === "paged" ? "Page layout" : "Layout undetermined";

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
export function normalizeTitle(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}
function stripReleaseSuffix(value: string): string {
  return value.replace(/\.(cbz|zip|pdf|epub|docx)$/i, "")
    .replace(/\s*\[[^\]]{1,100}\]\s*/g, " ")
    .replace(/(?:\s+|[._-])(?:chapter|chap|ch|volume|vol|v|c)\.?\s*\d+(?:[._]\d+)?(?:\s.*)?$/i, "")
    .replace(/[._]/g, " ").trim();
}
/** Versions before 0.3.2 read element.text and its child text a second time. */
export function legacyTitleAlias(value: string): string {
  const words = value.trim().split(/\s+/);
  if (words.length >= 4 && words.length % 2 === 0) {
    const half = words.length / 2;
    if (normalizeTitle(words.slice(0, half).join(" ")) === normalizeTitle(words.slice(half).join(" "))) return words.slice(0, half).join(" ");
  }
  return value;
}
export function lookupTitles(books: readonly Book[]): string[] {
  return unique(books.flatMap((b) => [b.series, b.metadata.seriesHint ?? "", ...(b.metadata.alternateTitles ?? []),
    ...(b.metadata.classification?.aliases ?? []), stripReleaseSuffix(b.metadata.sourceFilename ?? "")])
    .flatMap((title) => [title, legacyTitleAlias(title)]).map((s) => s.trim())).filter((s) => normalizeTitle(s).length >= 2).slice(0, 80);
}
export function preferredQuery(books: readonly Book[]): string {
  const first = books.find((b) => b.metadata.seriesHint)?.metadata.seriesHint || books[0]?.series || "";
  return legacyTitleAlias(first).slice(0, 200);
}
export function originMedium(value: string): Medium | null {
  switch (value.trim().toLowerCase().replace(/_/g, "-")) {
    case "jp": case "jpn": case "japan": case "ja": case "ja-jp": case "japanese": return "manga";
    case "kr": case "kor": case "korea": case "south korea": case "ko": case "ko-kr": case "korean": return "manhwa";
    case "cn": case "chn": case "china": case "zh": case "zh-cn": case "zh-hk": case "zh-tw": case "zh-hans": case "zh-hant": case "chinese": case "tw": case "taiwan": case "hk": case "hong kong": return "manhua";
    default: return null;
  }
}
function category(value: string): Medium | null {
  switch (value.trim().toLowerCase()) {
    case "manga": return "manga";
    case "manhwa": return "manhwa";
    case "manhua": return "manhua";
    case "comic": case "western comic": case "western comics": return "comic";
    default: return null;
  }
}
function longstripLabel(value: string): boolean {
  return /^(webtoon|webtoons|long[ -]?strip|vertical(?: scroll(?:ing)?)?|scroll(?:ing)?)$/i.test(value.trim());
}
export function pageLayout(pages: readonly PageSize[]): { layout: ComicLayout; evidence: string } {
  // Do not decode or OCR full books. This is an inexpensive structural hint, never origin evidence.
  const valid = pages.filter((p) => p.width >= 100 && p.height >= 100);
  const sample = (valid.length >= 5 ? valid.slice(1, -1) : valid).slice(0, 120);
  const ratios = sample.map((p) => p.height / p.width).sort((a, b) => a - b);
  if (!ratios.length) return { layout: "unknown", evidence: "Page dimensions are unavailable." };
  const median = ratios[Math.floor(ratios.length / 2)];
  const tall = ratios.filter((r) => r >= 2.2).length;
  if ((ratios.length >= 3 && tall / ratios.length >= 0.6) || (ratios.length >= 2 && median >= 3)) {
    return { layout: "longstrip", evidence: `${tall}/${ratios.length} sampled pages are tall strips. This suggests vertical presentation, not country of origin.` };
  }
  if (ratios.length >= 3 && median >= 0.6 && median <= 1.9) return { layout: "paged", evidence: "Page proportions resemble conventional pages; cropped webtoons can have the same proportions." };
  return { layout: "unknown", evidence: "Too little consistent layout evidence. A cover or one tall image is not enough." };
}
function baseDecision(): ClassificationDecision {
  return { medium: "unknown", layout: "unknown", status: "unknown", source: "No reliable origin evidence", evidence: [], warnings: [], candidateId: "", aliases: [], originalLanguage: "", locked: false, version: CLASSIFIER_VERSION };
}
function unpackDuplicatedMetadata(value: string): string {
  // Recovery for old XML fields such as 'ko ko' or 'YesAndRightToLeft YesAndRightToLeft'.
  const words = value.trim().split(/\s+/);
  return words.length === 2 && words[0].toLowerCase() === words[1].toLowerCase() ? words[0] : value.trim();
}
export function classifyLocal(books: readonly Book[]): ClassificationDecision {
  const result = baseDecision();
  if (!books.length) return result;
  const locked = books.flatMap((b) => b.metadata.classification?.locked ? [b.metadata.classification] : []);
  if (locked.length && new Set(locked.map((d) => `${d.medium}:${d.layout}`)).size === 1) return { ...locked[0], warnings: [...locked[0].warnings], evidence: [...locked[0].evidence] };
  if (locked.length) return { ...result, status: "conflict", warnings: ["Chapters have conflicting pinned types. Choose one type for the entire shelf."] };
  const claims: { medium: Medium; evidence: string; strength: number }[] = [];
  const sources = new Set<string>();
  for (const book of books) {
    const m = book.metadata;
    result.warnings.push(...(m.metadataWarnings ?? []));
    const origin = unpackDuplicatedMetadata(m.countryOfOrigin ?? "");
    const originalLanguage = unpackDuplicatedMetadata(m.originalLanguage ?? "");
    const fromOrigin = originMedium(origin);
    const fromLanguage = originMedium(originalLanguage);
    if (fromOrigin) claims.push({ medium: fromOrigin, evidence: `Embedded country of origin: ${origin}`, strength: 3 });
    if (fromLanguage) {
      claims.push({ medium: fromLanguage, evidence: `Embedded ORIGINAL language: ${originalLanguage}`, strength: 3 });
      result.originalLanguage = originalLanguage;
    }
    const labels = [...m.genres, ...(m.tags ?? []), m.publicationFormat ?? ""].flatMap((label) => label.split(/[,;]/)).map(unpackDuplicatedMetadata);
    for (const label of labels) {
      const medium = category(label);
      if (medium) claims.push({ medium, evidence: `Embedded category/tag: ${label}`, strength: 3 });
      if (longstripLabel(label)) { result.layout = "longstrip"; result.evidence.push(`Embedded format/tag: ${label}`); }
    }
    if (/^(yes|yesandrighttoleft)$/i.test(unpackDuplicatedMetadata(m.mangaIndicator ?? ""))) {
      claims.push({ medium: "manga", evidence: `ComicInfo Manga flag: ${unpackDuplicatedMetadata(m.mangaIndicator!)}`, strength: 1 });
    }
    if (m.language) result.evidence.push(`Edition language: ${unpackDuplicatedMetadata(m.language)} (not used as original-language evidence).`);
    if (m.sourceUrl) result.evidence.push(`Embedded source/reference: ${m.sourceUrl}`);
    if (m.publisher) result.evidence.push(`Publisher: ${m.publisher} (a translated-edition publisher does not establish origin).`);
    if (m.metadataSource) sources.add(m.metadataSource);
    // Never infer a country from a download host, a watermark, a translated SFX, or an alphabet in the title.
  }
  if (result.layout !== "longstrip") {
    const layout = pageLayout(books.flatMap((b) => b.pages));
    result.layout = layout.layout;
    result.evidence.push(layout.evidence);
  }
  const strongest = claims.filter((c) => c.strength === Math.max(0, ...claims.map((c) => c.strength)));
  const types = unique(strongest.map((c) => c.medium));
  result.evidence.push(...claims.map((c) => c.evidence));
  if (types.length > 1) {
    result.status = "conflict"; result.warnings.push("Embedded fields disagree about origin/type. Review the evidence instead of accepting a guess.");
  } else if (types.length === 1) {
    result.medium = types[0] as Medium;
    result.status = strongest[0].strength >= 3 ? "confirmed" : "suggested";
    result.source = sources.size ? [...sources].join(" + ") : "Embedded metadata";
  } else {
    const known = books.map((b) => b.metadata.classification).filter((d): d is ClassificationDecision => !!d && d.status === "confirmed");
    if (known.length && new Set(known.map((d) => d.medium)).size === 1) {
      return { ...known[0], warnings: unique([...known[0].warnings, ...result.warnings]), evidence: unique([...known[0].evidence, ...result.evidence]) };
    }
    const olderTypes = unique(books.map((b) => b.metadata.medium).filter((v) => !["unknown", "comic", "webtoon"].includes(v)));
    if (olderTypes.length === 1) {
      result.medium = olderTypes[0] as Medium; result.status = "suggested";
      result.source = "Previously saved type (unverified)";
      result.warnings.push("This older classification has no recorded supporting source; it has not been independently verified.");
    }
    if (books.some((b) => b.metadata.medium === "webtoon")) result.layout = "longstrip";
  }
  result.evidence = unique(result.evidence).slice(0, 50);
  result.warnings = unique(result.warnings).slice(0, 30);
  result.aliases = lookupTitles(books).slice(0, 40);
  return result;
}

// Decode provider payloads defensively. Schema/HTTP errors become visible diagnostics, not 'Comic'.
type ObjectValue = Record<string, unknown>;
const obj = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => typeof v === "string" ? v : "";
const strings = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
const identifier = (v: unknown): string => typeof v === "number" && Number.isInteger(v) && v > 0 ? String(v) : str(v);
function candidateBase(provider: string, id: string): ClassificationCandidate {
  return { provider, id, title: "", aliases: [], authors: [], medium: "unknown", layout: "unknown", originalLanguage: "", url: "", relatedIds: [], match: "possible" };
}
export function parseProvider(response: ClassificationProviderResponse): { candidates: ClassificationCandidate[]; warnings: string[] } {
  if (response.error) return { candidates: [], warnings: [`${response.provider}: ${response.error}`] };
  const body = obj(response.data);
  if (arr(body.errors).length) return { candidates: [], warnings: [`${response.provider}: ${arr(body.errors).map((e) => str(obj(e).message)).filter(Boolean).join("; ") || "API error"}`] };
  let items: unknown[] = [];
  const candidates: ClassificationCandidate[] = [];
  if (response.provider === "MyAnimeList / Jikan" || response.provider === "MangaDex") {
    if (!body.data) return { candidates: [], warnings: [`${response.provider}: unexpected response schema (missing data).`] };
    items = Array.isArray(body.data) ? body.data : [body.data];
  } else {
    const data = obj(body.data);
    if (data.Media) items = [data.Media];
    else if (Array.isArray(obj(data.Page).media)) items = arr(obj(data.Page).media);
    else return { candidates: [], warnings: ["AniList: unexpected response schema (missing Media/Page.media)."] };
  }
  for (const value of items.slice(0, 25)) {
    const item = obj(value);
    if (response.provider === "MyAnimeList / Jikan") {
      const medium = category(str(item.type));
      // 'Manga' is not the same as the endpoint's /manga name; explicit type is required.
      if (!medium) continue;
      const id = identifier(item.mal_id); if (!/^\d+$/.test(id)) continue;
      const c = candidateBase(response.provider, `mal:${id}`);
      c.title = str(item.title);
      c.aliases = unique([c.title, str(item.title_english), str(item.title_japanese), ...strings(item.title_synonyms), ...arr(item.titles).map((t) => str(obj(t).title))]);
      c.authors = arr(item.authors).map((a) => str(obj(a).name)); c.medium = medium;
      c.url = `https://myanimelist.net/manga/${id}`;
      const tags = [...arr(item.genres), ...arr(item.themes), ...arr(item.explicit_genres)].map((t) => str(obj(t).name));
      if (tags.some(longstripLabel)) c.layout = "longstrip";
      c.match = response.directId === id ? "id" : "possible"; candidates.push(c);
    } else if (response.provider === "MangaDex") {
      const id = identifier(item.id); if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) continue;
      const a = obj(item.attributes); const titles = obj(a.title);
      const c = candidateBase(response.provider, `md:${id}`);
      c.title = str(titles.en) || str(Object.values(titles)[0]);
      c.aliases = unique([...Object.values(titles).map(str), ...arr(a.altTitles).flatMap((t) => Object.values(obj(t)).map(str))]);
      c.originalLanguage = str(a.originalLanguage); c.medium = originMedium(c.originalLanguage) ?? "unknown";
      c.authors = arr(item.relationships).filter((r) => obj(r).type === "author").map((r) => str(obj(obj(r).attributes).name));
      const tags = arr(a.tags).flatMap((t) => Object.values(obj(obj(obj(t).attributes).name)).map(str));
      if (tags.some(longstripLabel)) c.layout = "longstrip";
      c.url = `https://mangadex.org/title/${id}`;
      if (identifier(obj(a.links).mal)) c.relatedIds.push(`mal:${identifier(obj(a.links).mal)}`);
      if (identifier(obj(a.links).al)) c.relatedIds.push(`al:${identifier(obj(a.links).al)}`);
      c.match = response.directId === id ? "id" : "possible"; candidates.push(c);
    } else {
      if (!["MANGA", "ONE_SHOT"].includes(str(item.format))) continue; // Never confuse novel adaptations.
      const id = identifier(item.id); if (!/^\d+$/.test(id)) continue;
      const c = candidateBase(response.provider, `al:${id}`);
      const titles = obj(item.title);
      c.title = str(titles.english) || str(titles.romaji) || str(titles.native);
      c.aliases = unique([...Object.values(titles).map(str), ...strings(item.synonyms)]);
      c.medium = originMedium(str(item.countryOfOrigin)) ?? "unknown";
      c.authors = arr(obj(item.staff).nodes).map((n) => str(obj(obj(n).name).full));
      if (arr(item.tags).some((t) => longstripLabel(str(obj(t).name)))) c.layout = "longstrip";
      c.url = `https://anilist.co/manga/${id}`;
      if (identifier(item.idMal)) c.relatedIds.push(`mal:${identifier(item.idMal)}`);
      c.match = response.directId === id ? "id" : "possible"; candidates.push(c);
    }
  }
  return { candidates: candidates.filter((c) => !!c.title), warnings: [] };
}
function tokens(value: string): Set<string> {
  return new Set(value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((v) => v && !["the", "a", "of", "no", "to", "and"].includes(v)));
}
function resemblance(a: string, b: string): number {
  const x = tokens(a), y = tokens(b); if (!x.size || !y.size) return 0;
  return 2 * [...x].filter((t) => y.has(t)).length / (x.size + y.size);
}
export function classifyWithSources(books: readonly Book[], lookup: ClassificationLookup, searchAlias = ""): { decision: ClassificationDecision; candidates: ClassificationCandidate[] } {
  const local = classifyLocal(books);
  if (local.locked) return { decision: local, candidates: [] };
  const wanted = unique([...lookupTitles(books), searchAlias].filter(Boolean));
  const keys = new Set(wanted.map(normalizeTitle));
  const parsed = lookup.responses.map(parseProvider);
  const candidates = parsed.flatMap((r) => r.candidates).map((candidate) => ({ ...candidate,
    match: candidate.match === "id" ? "id" as const : candidate.aliases.some((a) => keys.has(normalizeTitle(a))) ? "title" as const : "possible" as const,
  }));
  const uniqueCandidates = [...new Map(candidates.map((c) => [c.id, c])).values()];
  const sortScore = (c: ClassificationCandidate) => c.match === "id" ? 3 : c.match === "title" ? 2 : Math.max(0, ...c.aliases.flatMap((a) => wanted.map((t) => resemblance(a, t))));
  uniqueCandidates.sort((a, b) => sortScore(b) - sortScore(a));
  const warnings = unique([...local.warnings, ...lookup.warnings, ...parsed.flatMap((r) => r.warnings)]);
  const exact = uniqueCandidates.filter((c) => c.match !== "possible");
  // An explicit per-series source ID has precedence over a title-only hit.
  const direct = exact.filter((c) => c.match === "id");
  const matching = direct.length ? direct : exact;
  const providerAmbiguous = matching.some((c) => matching.some((d) => d.provider === c.provider && d.id !== c.id));
  // Same titles can belong to different works. Disagreeing cross-catalog IDs or
  // clearly disjoint credited authors require a human choice even when types agree.
  const authorKey = (author: string) => [...tokens(author)].map(normalizeTitle).sort().join("|");
  const identityConflict = matching.some((a) => matching.some((b) => {
    if (a.id === b.id || a.provider === b.provider) return false;
    const prefix = b.id.split(":")[0] + ":";
    const ids = a.relatedIds.filter((id) => id.startsWith(prefix));
    if (ids.length && !ids.includes(b.id)) return true;
    if (a.relatedIds.includes(b.id) || b.relatedIds.includes(a.id)) return false;
    const aa = a.authors.map(authorKey).filter(Boolean), bb = b.authors.map(authorKey).filter(Boolean);
    return aa.length > 0 && bb.length > 0 && !aa.some((name) => bb.includes(name));
  }));
  const types = unique(matching.map((c) => c.medium).filter((m) => m !== "unknown"));
  const decision = { ...local, warnings };
  if (providerAmbiguous || identityConflict || types.length > 1) {
    decision.medium = "unknown"; decision.status = "conflict"; decision.source = "Conflicting catalog matches";
    decision.warnings.push(identityConflict ? "Same-title matches have conflicting authors or catalog IDs. Confirm the actual work before applying a type." : providerAmbiguous ? "More than one work matches this title in the same catalog. Select the correct edition/work." : "Matching catalogs disagree about type/origin. Choose the correct entry.");
  } else if (types.length === 1) {
    const medium = types[0] as Medium;
    if (local.status === "conflict" || (local.status === "confirmed" && local.medium !== medium)) {
      decision.medium = "unknown"; decision.status = "conflict"; decision.source = "Local/online conflict";
      decision.warnings.push(`File metadata and online metadata disagree (${typeLabel(local.medium)} vs ${typeLabel(medium)}). No automatic type was chosen.`);
    } else {
      decision.medium = medium; decision.status = "confirmed";
      decision.source = unique(matching.filter((c) => c.medium === medium).map((c) => c.provider)).join(" + ");
      decision.candidateId = matching.find((c) => c.medium === medium)?.id ?? "";
      decision.originalLanguage = matching.find((c) => c.originalLanguage)?.originalLanguage ?? local.originalLanguage;
      decision.aliases = unique([...wanted, ...matching.flatMap((c) => c.aliases)]).slice(0, 40);
      decision.evidence = unique([...local.evidence, ...matching.map((c) => `${c.provider}: ${c.title} (${typeLabel(c.medium)}); matched by ${c.match === "id" ? "embedded source ID" : "title/alternate title"}. ${c.url}`)]).slice(0, 50);
    }
  } else if (local.status !== "confirmed") {
    decision.warnings.push("No unique catalog match. Review suggested titles, supply an alternate title, or pin the correct type.");
  }
  if (matching.some((c) => c.layout === "longstrip")) {
    decision.layout = "longstrip";
    decision.evidence = unique([...decision.evidence, "Matching catalog marks this work as long-strip/webtoon."]);
  }
  return { decision, candidates: uniqueCandidates.slice(0, 15) };
}
export function chooseCandidate(candidate: ClassificationCandidate, local: ClassificationDecision): ClassificationDecision {
  return { ...local, medium: candidate.medium, layout: candidate.layout === "unknown" ? local.layout : candidate.layout,
    status: "confirmed", source: `${candidate.provider} (user confirmed)`, candidateId: candidate.id, aliases: candidate.aliases.slice(0, 40),
    originalLanguage: candidate.originalLanguage, evidence: unique([...local.evidence, `User selected ${candidate.title}: ${candidate.url}`]),
    warnings: [], locked: true, version: CLASSIFIER_VERSION };
}
export function pinType(medium: Medium, layout: ComicLayout, local: ClassificationDecision): ClassificationDecision {
  return { ...local, medium, layout, status: medium === "unknown" ? "unknown" : "confirmed", source: "User-confirmed shelf type",
    evidence: [...local.evidence.filter((e) => !e.startsWith("User selected type:")), `User selected type: ${typeLabel(medium)}; ${layoutLabel(layout)}`].slice(0, 50),
    warnings: [], candidateId: "", locked: true, version: CLASSIFIER_VERSION };
}
export function effectiveMedium(book: Book): Medium {
  if (book.kind === "novel") return "novel";
  const saved = book.metadata.classification;
  if (saved) return saved.medium;
  return classifyLocal([book]).medium;
}
export function matchesComicFilter(book: Book, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "webtoon") return (book.metadata.classification?.layout ?? classifyLocal([book]).layout) === "longstrip";
  return effectiveMedium(book) === filter;
}
