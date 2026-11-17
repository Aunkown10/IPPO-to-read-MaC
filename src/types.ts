export type Direction = "ltr" | "rtl";
export type ReadingMode = "paged" | "scroll";
export type Medium = "unknown" | "comic" | "manga" | "manhwa" | "manhua" | "webtoon" | "novel";
export interface Progress {
  page: number;
  offset: number;
  mode: ReadingMode;
  direction: Direction;
  zoom: number;
}
export interface PageSize { width: number; height: number; mime: string }
export interface BookMetadata {
  author: string;
  publisher: string;
  language: string;
  genres: string[];
  description: string;
  sourceUrl: string;
  medium: Medium;
  metadataSource: string;
  tags?: string[];
  alternateTitles?: string[];
  originalLanguage?: string;
  countryOfOrigin?: string;
  publicationFormat?: string;
  mangaIndicator?: string;
  sourceFilename?: string;
  metadataWarnings?: string[];
  metadataRevision?: number;
  classification?: ClassificationDecision | null;
  titleHint?: string;
  seriesHint?: string;
  volumeHint?: number | null;
  chapterHint?: number | null;
}
export interface Book {
  id: string;
  title: string;
  series: string;
  volume: number | null;
  chapter: number | null;
  kind: "images" | "pdf" | "novel";
  format: string;
  pages: PageSize[];
  hasCover: boolean;
  progress: Progress;
  lastRead: number;
  addedAt: number;
  isPrivate: boolean;
  metadata: BookMetadata;
  readingSeconds: number;
  wordCount: number;
}
export interface EditBook {
  title: string;
  series: string;
  volume: number | null;
  chapter: number | null;
  author: string;
  publisher: string;
  language: string;
  genres: string[];
  description: string;
  sourceUrl: string;
  medium: Medium;
}
export interface NovelChapter { title: string; text: string; wordCount: number }
export interface NovelDocument { chapters: NovelChapter[]; wordCount: number }
export interface ReviewCard { provider: string; title: string; score: number | null; body: string; url: string }
export interface MediumDetection { medium?: Exclude<Medium, "novel"> | null; matchedTitle: string; source: string }
export interface SeriesReviewBundle { cards: ReviewCard[]; matchedTitle: string; warnings: string[]; suggestedMedium?: Exclude<Medium, "novel"> | null; classificationSource: string }
export interface VaultStatus { configured: boolean; unlocked: boolean }
export interface VaultResetResult { warnings: string[] }
export interface ImportReport { imported: Book[]; errors: string[]; warnings: string[] }
export interface TransferResult { book: Book; cleanupWarning: string | null }
export interface MusicTrack { id: string; title: string; addedAt: number }
export interface MusicPlaylist { id: string; name: string; trackIds: string[] }
export interface MusicSnapshot { tracks: MusicTrack[]; playlists: MusicPlaylist[] }
export interface WatchedFolder { id: string; path: string; addedAt: number }
export interface WatchSyncResult { imported: Book[]; matchedExisting: number; errors: string[] }
export interface Preferences {
  theme: "system" | "light" | "dark";
  direction: Direction;
  mode: ReadingMode;
  onlineMetadata: boolean;
  readingTimeTracking: boolean;
}
export interface Shelf {
  key: string;
  title: string;
  books: Book[];
  resume: Book;
  lastRead: number;
}
export const EMPTY_METADATA: BookMetadata = {
  author: "", publisher: "", language: "", genres: [], description: "", sourceUrl: "", medium: "unknown", metadataSource: "",
};
export const DEFAULT_PREFERENCES: Preferences = { theme: "system", direction: "ltr", mode: "paged", onlineMetadata: true, readingTimeTracking: true };

export type ComicLayout = "unknown" | "paged" | "longstrip";
export interface ClassificationDecision {
  medium: Medium;
  layout: ComicLayout;
  status: "confirmed" | "suggested" | "unknown" | "conflict";
  source: string;
  evidence: string[];
  warnings: string[];
  candidateId: string;
  aliases: string[];
  originalLanguage: string;
  locked: boolean;
  version: number;
}
export interface ClassificationProviderResponse {
  provider: "MyAnimeList / Jikan" | "MangaDex" | "AniList";
  data?: unknown;
  error?: string;
  directId?: string;
}
export interface ClassificationCandidate {
  provider: string;
  id: string;
  title: string;
  aliases: string[];
  authors: string[];
  medium: Medium;
  layout: ComicLayout;
  originalLanguage: string;
  url: string;
  relatedIds: string[];
  match: "id" | "title" | "possible";
}
export interface ClassificationLookup {
  responses: ClassificationProviderResponse[];
  warnings: string[];
}
