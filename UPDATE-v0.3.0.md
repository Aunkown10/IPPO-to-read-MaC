# Ippo to Read v0.3.0 — Novels, Metadata & Reading Time

## New

- Dedicated **Novels** tab with a calmer bookshelf and continue-reading card.
- Novel reader for EPUB, text-heavy DOCX and UTF-8 TXT.
- Novel appearance controls: Paper, Warm, Sepia, Night and OLED themes; serif/sans fonts; text size, line spacing and reading width.
- Chapter navigation and normalized scroll-position bookmarks for novels.
- Active reading-time tracking that pauses when Ippo is hidden, unfocused or idle for 60 seconds.
- Reading-time dashboard with totals for comics/novels and a most-read list.
- Comic library filters: Manga, Manhwa, Manhua, Comic and Webtoon.
- Metadata ingestion from ComicInfo.xml, EPUB package metadata/series fields and DOCX core properties.
- Expanded metadata editor for author, publisher, language, genres, source URL and medium classification.
- Optional online series cards for MyAnimeList (through Jikan), ComicK tracker information and embedded publisher/source information.
- Online series cards are cached locally for seven days after a successful lookup.
- Private shelves never perform online metadata lookups.
- TXT can be imported and watched in the normal library.
- A novel-only import picker keeps the quiet bookshelf from accidentally selecting image comics.

## Existing systems preserved

- Paged, RTL/LTR, vertical-scroll and page-flip comic reading.
- Zero-gap manhwa scrolling.
- Managed custom shelf covers.
- Completion-aware Continue Reading.
- Managed offline MP3 library and playlists shared across Comics and Novels.
- Encrypted private library, recovery reset flow and manual-only private imports.
- Watched normal-library folders with duplicate adoption.

## Metadata priority

Ippo now prefers embedded file metadata where available, then falls back to the
existing folder/filename parser. Metadata is editable inside Ippo and does not
rename the original source file.

## Limits

- PDF remains a fixed-page comic/document reader in this release; PDF text is not reflowed into Novel mode.
- Legacy DOC, CBR/RAR and 7z remain unsupported.
- ComicK and Jikan are optional network providers and can change/rate-limit independently of Ippo.
- “Original publisher” uses publisher/source information embedded in the file; there is no universal publisher-review API.
