# Ippo to Read 0.3.2 - Evidence-based comic classification

## Install over 0.3.1

Close Ippo and stop `npm run desktop` with Ctrl+C. Back up BOTH your project and Ippo's application-data directory before replacing files. This update records an `unknown` category and additional JSON metadata fields; it marks the database as schema version 5 to stop older versions from misreading those records. To roll back, restore the matching app-data backup as well as the old source.

Copy the patch's contents into the project directory containing `package.json` and `Cargo.toml`. Do not put the patch inside an extra subfolder. No new npm or Cargo dependencies are added.

In PowerShell, inside your project:

```powershell
npm.cmd test
npm.cmd run test:classification:types
npm.cmd run test:native
npm.cmd run desktop
```

The native test runs use temporary libraries, not your actual library. `verify-update.cmd` additionally runs the full installed-dependency TypeScript check and desktop Cargo check before launching is attempted. It never opens your real library.

## What changed

- **XML text duplication fixed.** The previous `text_of` visited element.text AND its text child, duplicating fields such as a series name, chapter number or Manga flag. The new reader reads each text node once. BOM-marked UTF-16 metadata is supported, malformed metadata is reported, and conflicting nested ComicInfo files are not chosen at random.
- **Read more actual fields.** Retain tags, publication format, localized titles, reference URLs, and explicit original-language/country extensions. `LanguageISO` remains the language of the imported edition; it is not silently treated as country of origin.
- **Fix the search bottleneck.** The classifier no longer relies on the old first-result-only ComicK lookup. New bounded metadata adapters query MyAnimeList via Jikan, MangaDex, and AniList. They consider up to 20 candidates, alternate titles/synonyms, recognized catalog IDs, original-language/country fields, and collisions between same-title works.
- **Show failures.** HTTP errors, throttling, invalid response schemas, missing metadata, ambiguous matches and conflicting evidence are surfaced in the classification report. Failure no longer means a confident `Comic` label.
- **Separate type and layout.** Manga / Manhwa / Manhua / Comic / Unclassified are origin/category filters. Webtoon / long-strip is a separate, overlapping presentation filter. A Manhwa can appear under both Manhwa and Webtoon / long-strip.
- **Layout is only a clue.** Sample existing page dimensions, excluding first/last outliers where possible. Do not decode or OCR the full book. One tall cover, full color, LTR/RTL or the user's Scroll setting does not determine a country.
- **Per-shelf corrections.** Right-click a shelf > **Classification / fix type**. See evidence, check local metadata, search using an alternate title, select a catalog result, or pin the correct type and layout. Pinned choices apply to every chapter in that shelf and are inherited by future chapters; automatic classification does not overwrite them.
- **Recover available old metadata.** Old releases discarded some embedded fields. When an older book has an existing watched original CBZ/ZIP, the update can read ComicInfo again without importing another copy. The report also provides **Read ComicInfo from original file...** for manually choosing a chapter from that same series. This reads metadata only, not a second copy of the chapter. If the original is gone, discarded fields cannot be recreated; catalog matching or a manual choice is needed.
- **Privacy preserved.** Private titles use only local evidence/manual choices; the backend rejects online classification for private book IDs. Ordinary catalog queries send a series title or recognized catalog IDs, never comic pages, paths, or sound-effect images. Private classification data stays inside the encrypted book record.

## How to use

1. In Comics, select **All types** and click **Recheck classification**. Existing unclassified records are also checked once when loaded. The progress line shows the shelf being checked.
2. Open **Classification / fix type** from a shelf's right-click menu (or the Series info section) to inspect the reason behind its label.
3. To correct a missing or wrong result, select the correct catalog entry or choose a type in **Set the correct type yourself**, then **Save type for this entire comic**.

Catalog search requires connectivity and catalog coverage. A search result with only a vaguely similar title is shown as a suggestion, not silently accepted. A work's translation language, SFX lettering or download website is not sufficient to prove origin. This release does not include visual SFX language recognition or a machine-learning image classifier.

It does not change comic file contents, reading mode, bookmarks, covers, music, playlists or shelf names. Metadata reclassification does not import or delete chapters. It also does not repair unrelated pre-existing duplicate imports or rename older duplicated series labels; an old duplicated XML title is used as a search alias without merging shelves.

## Validation boundaries

- 73 JavaScript/TypeScript unit tests executed and passed (43 new classification tests + 30 reader tests).
- Strict TypeScript check of the classifier and shared models passed, with no dependency stubs.
- All 22 TypeScript/TSX source/test files passed syntax checks.
- Added native XML parser, atomic persistence, privacy, pin-inheritance, metadata reread and source-ID validation tests. **Not executed here**: Cargo is unavailable.
- Full installed-dependency frontend check, Tauri/Windows compilation, visual interaction testing, live catalog responses and the user's three actual archives remain unverified here. Network access from the build environment failed; provider unit tests use explicit synthetic fixtures, not claimed live responses.

No promise of perfect automatic classification is made for metadata-free, translated or ambiguous works. The report and shelf-wide override are intentional fallbacks, not hidden errors.

## Reference documentation

- ComicInfo schema: https://anansi-project.github.io/docs/comicinfo/documentation
- Jikan v4: https://docs.api.jikan.moe/
- MangaDex official API documentation: https://api.mangadex.org/docs/
- MangaDex documentation repository: https://gitlab.com/mangadex-pub/mangadex-api-docs
- AniList API queries: https://docs.anilist.co/guide/graphql/queries/media

These links document API contracts; they are not a claim of live connectivity from this build environment.
