import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_METADATA } from "../src/types.ts";
import type { Book, BookMetadata, ClassificationLookup, ClassificationProviderResponse } from "../src/types.ts";
import { classifyLocal, classifyWithSources, effectiveMedium, legacyTitleAlias, lookupTitles, matchesComicFilter, normalizeTitle, originMedium, pageLayout, parseProvider, pinType, chooseCandidate } from "../src/lib/classification.ts";

function book(metadata: Partial<BookMetadata> = {}, patch: Partial<Book> = {}): Book {
  return { id: "1", title: "Chapter 1", series: "Paper Kingdom", volume: null, chapter: 1, kind: "images", format: "CBZ", pages: [], hasCover: false,
    lastRead: 0, addedAt: 1, isPrivate: false, readingSeconds: 0, wordCount: 0,
    progress: { page: 0, offset: 0, mode: "paged", direction: "ltr", zoom: 1 }, metadata: { ...EMPTY_METADATA, ...metadata }, ...patch };
}
const mal = (data: unknown, directId?: string): ClassificationProviderResponse => ({ provider: "MyAnimeList / Jikan", data: { data }, directId });
const al = (media: unknown[]): ClassificationProviderResponse => ({ provider: "AniList", data: { data: { Page: { media } } } });
const md = (data: unknown): ClassificationProviderResponse => ({ provider: "MangaDex", data: { data } });
const lookup = (...responses: ClassificationProviderResponse[]): ClassificationLookup => ({ responses, warnings: [] });
const pages = (n: number, width: number, height: number) => Array.from({ length: n }, () => ({ width, height, mime: "image/jpeg" }));
const uuid = "11111111-2222-3333-4444-555555555555";

test("missing metadata is Unclassified, not a confident Comic label", () => {
  assert.equal(classifyLocal([book()]).medium, "unknown");
  assert.equal(effectiveMedium(book({ medium: "comic" })), "unknown");
});
test("English translated edition is not treated as Western comics", () => {
  const d = classifyLocal([book({ language: "en", publisher: "English Comics Publisher" })]);
  assert.equal(d.medium, "unknown"); assert.ok(d.evidence.some((e) => e.includes("Edition language")));
});
test("Korean edition language alone is not proof of origin either", () => assert.equal(classifyLocal([book({ language: "ko" })]).medium, "unknown"));
test("explicit ORIGINAL language classifies an English-translated manhwa", () => {
  const d = classifyLocal([book({ originalLanguage: "ko", language: "en" })]);
  assert.equal(d.medium, "manhwa"); assert.equal(d.status, "confirmed");
});
test("country of origin mappings support Japan Korea China Taiwan", () => {
  assert.equal(originMedium("JP"), "manga"); assert.equal(originMedium("South Korea"), "manhwa");
  assert.equal(originMedium("zh-Hant"), "manhua"); assert.equal(originMedium("TW"), "manhua"); assert.equal(originMedium("en"), null);
});
test("explicit Tags manhwa plus webtoon retains both dimensions", () => {
  const d = classifyLocal([book({ tags: ["Manhwa", "Webtoon"], language: "en" })]);
  assert.equal(d.medium, "manhwa"); assert.equal(d.layout, "longstrip");
});
test("manga label with tall pages remains manga", () => {
  const d = classifyLocal([book({ originalLanguage: "ja" }, { pages: pages(6, 700, 3500) })]);
  assert.equal(d.medium, "manga"); assert.equal(d.layout, "longstrip");
});
test("scroll mode does not decide nationality or format", () => {
  const b = book({}, { progress: { page: 0, offset: 0, mode: "scroll", direction: "ltr", zoom: 1 } });
  assert.equal(classifyLocal([b]).medium, "unknown"); assert.equal(classifyLocal([b]).layout, "unknown");
});
test("tall images suggest layout but cannot distinguish manhua from manhwa", () => {
  const d = classifyLocal([book({}, { pages: pages(20, 800, 3000) })]);
  assert.equal(d.medium, "unknown"); assert.equal(d.layout, "longstrip");
});
test("single tall cover is insufficient for long-strip classification", () => assert.equal(pageLayout(pages(1, 600, 8000)).layout, "unknown"));
test("ad/cover outliers are ignored when estimating strip layout", () => {
  assert.equal(pageLayout([...pages(1, 800, 10000), ...pages(8, 800, 1200), ...pages(1, 800, 9000)]).layout, "paged");
});
test("Manga flag alone is a suggestion and stronger explicit tags win", () => {
  assert.equal(classifyLocal([book({ mangaIndicator: "YesAndRightToLeft" })]).status, "suggested");
  assert.equal(classifyLocal([book({ mangaIndicator: "Yes", tags: ["manhwa"] })]).medium, "manhwa");
});
test("contradictory local origin fields are visible conflicts", () => {
  const d = classifyLocal([book({ countryOfOrigin: "JP", originalLanguage: "ko" })]);
  assert.equal(d.status, "conflict"); assert.equal(d.medium, "unknown");
});
test("malformed metadata warnings are displayed, not silently swallowed", () => {
  assert.ok(classifyLocal([book({ metadataWarnings: ["ComicInfo.xml invalid XML"] })]).warnings.includes("ComicInfo.xml invalid XML"));
});
test("old duplicated XML metadata values are interpreted correctly", () => {
  assert.equal(classifyLocal([book({ originalLanguage: "ko ko", genres: ["Manhwa Manhwa"] })]).medium, "manhwa");
  assert.equal(legacyTitleAlias("Paper Kingdom Paper Kingdom"), "Paper Kingdom");
  assert.ok(lookupTitles([book({}, { series: "Paper Kingdom Paper Kingdom" })]).includes("Paper Kingdom"));
});
test("normalized matching supports diacritics fullwidth punctuation and CJK", () => {
  assert.equal(normalizeTitle("\uff30aper: Kingd\u00f3m!"), "paperkingdom"); assert.notEqual(normalizeTitle("\u65e5\u672c"), "");
});
test("second or later MAL result matches, not only the first", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 1, type: "Manga", title: "Wrong Book" }, { mal_id: 2, type: "Manhwa", title: "Paper Kingdom" }])));
  assert.equal(r.decision.medium, "manhwa"); assert.equal(r.decision.candidateId, "mal:2");
});
test("MAL synonym/alternate English title can identify a romanized work", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 3, type: "Manhwa", title: "Jongi Kingdom", title_synonyms: ["Paper Kingdom"] }])));
  assert.equal(r.decision.status, "confirmed"); assert.equal(r.decision.medium, "manhwa");
});
test("MAL titles array is also matched", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 4, type: "Manga", title: "Kami Oukoku", titles: [{ type: "English", title: "Paper Kingdom" }] }])));
  assert.equal(r.decision.medium, "manga");
});
test("similar but unrelated titles are suggestions, not automatic classifications", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 5, type: "Manga", title: "Paper Kingdom: Next Generation" }])));
  assert.equal(r.decision.medium, "unknown"); assert.equal(r.candidates[0].match, "possible");
});
test("same-title distinct works in one provider require confirmation", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 6, type: "Manga", title: "Paper Kingdom" }, { mal_id: 7, type: "Manga", title: "Paper Kingdom" }])));
  assert.equal(r.decision.status, "conflict");
});
test("provider disagreement never guesses", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 7, type: "Manhwa", title: "Paper Kingdom" }]), al([{ id: 8, format: "MANGA", countryOfOrigin: "JP", title: { english: "Paper Kingdom" } }])));
  assert.equal(r.decision.status, "conflict"); assert.equal(r.decision.medium, "unknown");
});
test("embedded metadata and catalog disagreement is explicit", () => {
  const r = classifyWithSources([book({ tags: ["Manhua"] })], lookup(mal([{ mal_id: 9, type: "Manhwa", title: "Paper Kingdom" }])));
  assert.equal(r.decision.status, "conflict"); assert.ok(r.decision.warnings.some((w) => w.includes("disagree")));
});
test("MangaDex original language, altTitles and long-strip tags are read", () => {
  const r = classifyWithSources([book({ language: "en" })], lookup(md([{ id: uuid, attributes: { title: { ko: "\uc885\uc774 \uc655\uad6d" }, altTitles: [{ en: "Paper Kingdom" }], originalLanguage: "ko", tags: [{ attributes: { name: { en: "Long Strip" } } }] } }])));
  assert.equal(r.decision.medium, "manhwa"); assert.equal(r.decision.layout, "longstrip"); assert.equal(r.decision.originalLanguage, "ko");
});
test("MangaDex /manga endpoint is not evidence of Japanese origin", () => {
  const r = classifyWithSources([book()], lookup(md([{ id: uuid, attributes: { title: { en: "Paper Kingdom" }, originalLanguage: "en" } }])));
  assert.equal(r.decision.medium, "unknown");
});
test("AniList country is read independently from generic MANGA format", () => {
  const r = classifyWithSources([book()], lookup(al([{ id: 10, countryOfOrigin: "CN", format: "MANGA", title: { romaji: "Zhi Wang Guo" }, synonyms: ["Paper Kingdom"] }])));
  assert.equal(r.decision.medium, "manhua");
});
test("novel adaptations never classify comics via a shared title", () => {
  const r = classifyWithSources([book()], lookup(al([{ id: 10, countryOfOrigin: "JP", format: "NOVEL", title: { english: "Paper Kingdom" } }]), mal([{ mal_id: 11, type: "Light Novel", title: "Paper Kingdom" }])));
  assert.equal(r.candidates.length, 0); assert.equal(r.decision.medium, "unknown");
});
test("embedded catalog ID outranks loose title-only results", () => {
  const r = classifyWithSources([book()], lookup(mal({ mal_id: 12, type: "Manhwa", title: "A Different Official Title" }, "12"), al([{ id: 13, format: "MANGA", countryOfOrigin: "JP", title: { english: "Paper Kingdom" } }])));
  assert.equal(r.decision.medium, "manhwa"); assert.equal(r.decision.status, "confirmed");
});
test("HTTP rate limit and malformed API schemas produce visible diagnostics", () => {
  const r = classifyWithSources([book()], lookup({ provider: "MangaDex", error: "HTTP 429 (rate limited)" }, { provider: "MyAnimeList / Jikan", data: {} }));
  assert.ok(r.decision.warnings.some((w) => w.includes("429"))); assert.ok(r.decision.warnings.some((w) => w.includes("schema"))); assert.equal(r.decision.medium, "unknown");
});
test("GraphQL errors are not empty successful matches", () => {
  const r = parseProvider({ provider: "AniList", data: { errors: [{ message: "Rate limit" }] } });
  assert.deepEqual(r.candidates, []); assert.ok(r.warnings[0].includes("Rate limit"));
});
test("all providers offline preserves confirmed local metadata", () => {
  const r = classifyWithSources([book({ tags: ["Manhwa"] })], lookup({ provider: "MangaDex", error: "Unavailable" }));
  assert.equal(r.decision.medium, "manhwa"); assert.equal(r.decision.status, "confirmed"); assert.ok(r.decision.warnings.length);
});
test("long-strip work appears in BOTH origin and format filters", () => {
  const b = book({ tags: ["Manhwa", "Webtoon"] });
  b.metadata.classification = classifyLocal([b]);
  assert.ok(matchesComicFilter(b, "manhwa")); assert.ok(matchesComicFilter(b, "webtoon")); assert.ok(!matchesComicFilter(b, "manga"));
});
test("unknown is not mixed in with actual Comic filter", () => {
  const b = book(); assert.ok(matchesComicFilter(b, "unknown")); assert.ok(!matchesComicFilter(b, "comic"));
});
test("manual shelf classification cannot be overridden by automatic network guesses", () => {
  const b = book(); b.metadata.classification = pinType("manhwa", "longstrip", classifyLocal([b]));
  const r = classifyWithSources([b], lookup(mal([{ mal_id: 14, title: "Paper Kingdom", type: "Manga" }])));
  assert.equal(r.decision.medium, "manhwa"); assert.equal(r.decision.locked, true);
});
test("manual candidate selection records a pinned ID and source", () => {
  const c = parseProvider(mal([{ mal_id: 15, title: "Paper Kingdom", type: "Manhwa" }])).candidates[0];
  const d = chooseCandidate(c, classifyLocal([book()]));
  assert.equal(d.candidateId, "mal:15"); assert.ok(d.locked); assert.equal(d.medium, "manhwa");
});
test("source website name alone is not enough for origin", () => {
  assert.equal(classifyLocal([book({ sourceUrl: "https://some-manhwa-scans.example/series/1", language: "en" })]).medium, "unknown");
});
test("a Japanese title alphabet alone does not establish original publication country", () => {
  assert.equal(classifyLocal([book({}, { series: "\u3042\u3044\u3046\u3048\u304a" })]).medium, "unknown");
});
test("old wrongly defaulted Comic types become unclassified instead of remaining wrongly labeled", () => {
  assert.equal(classifyLocal([book({ medium: "comic", metadataSource: "Filename metadata" })]).medium, "unknown");
});
test("published comic category can be explicitly marked Comic", () => {
  assert.equal(classifyLocal([book({ tags: ["Western Comic"] })]).medium, "comic");
});
test("cross-chapter local evidence is considered across the whole shelf", () => {
  const d = classifyLocal([book(), book({ tags: ["Manhwa"] }, { id: "2", chapter: 2 })]); assert.equal(d.medium, "manhwa");
});

test("same-title cross-catalog ID disagreement is not accepted even for matching origins", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 5, title: "Paper Kingdom", type: "Manhwa" }]),
    md([{ id: uuid, attributes: { title: { en: "Paper Kingdom" }, originalLanguage: "ko", links: { mal: "999" } } }])));
  assert.equal(r.decision.status, "conflict");
});
test("disjoint credited authors flag same-title collisions", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 5, title: "Paper Kingdom", type: "Manhwa", authors: [{ name: "Writer A" }] }]),
    al([{ id: 6, title: { english: "Paper Kingdom" }, countryOfOrigin: "KR", format: "MANGA", staff: { nodes: [{ name: { full: "Different Creator" } }] } }])));
  assert.equal(r.decision.status, "conflict");
});
test("reversed first/last author order does not create a spurious conflict", () => {
  const r = classifyWithSources([book()], lookup(mal([{ mal_id: 5, title: "Paper Kingdom", type: "Manhwa", authors: [{ name: "Family, Given" }] }]),
    al([{ id: 6, title: { english: "Paper Kingdom" }, countryOfOrigin: "KR", format: "MANGA", staff: { nodes: [{ name: { full: "Given Family" } }] } }])));
  assert.equal(r.decision.status, "confirmed"); assert.equal(r.decision.medium, "manhwa");
});
