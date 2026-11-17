# Ippo to Read 0.3.7 - App icon

**Read [UPDATE-v0.3.7.md](UPDATE-v0.3.7.md).** Ippo now uses the new green manga-reader artwork as its application, installer, and frontend icon. This is a visual-only update; there is no database schema change.

# Ippo to Read 0.3.5 - EPUB + PDF novel reliability
**v0.3.5 fixes EPUB extraction, allows PDF files to be imported from the Novels tab, removes the old 5,000-page application cap, and changes PDF opening to gradual/background page-map loading.** Coverless EPUB/PDF novels still use the white title-card cover introduced in v0.3.4. See [UPDATE-v0.3.5.md](UPDATE-v0.3.5.md).


The small `!` box in the sidebar opens **Possible future updates**, currently listing third-party tracker connections, better metadata reading, direct external downloads, multiple UI layouts and an Android version. These are roadmap ideas, not active features.

The v0.3.2 classification repair remains included unchanged. Run `verify-update.cmd` on Windows before launching if you want the complete project checks. The authoring environment passed all 73 existing logic tests for this update.

---

## Earlier project documentation (historical feature descriptions)

# Ippo to Read

**Your library. Your direction. Your pace.**

A desktop-first, local comics-and-novels reader built with Tauri 2, React,
TypeScript, Rust and SQLite. v0.3 adds a dedicated calm Novel space, local
metadata-aware organization, active reading-time tracking, library type filters,
and optional online series information. It is source code, not a signed installer
or an independently audited security product.

## Start here

Install **Node.js 22.12 or newer**, npm, **current stable Rust** through rustup,
and the desktop prerequisites for your operating system. A recent system
WebView is needed for the PDF.js reader. Internet access is required to download
build dependencies the first time; the packaged reader uses local files and
bundled PDF assets, not a cloud service.

**Windows:** Install Microsoft C++ Build Tools with the "Desktop development
with C++" workload and a Windows SDK. Install Microsoft Edge WebView2 Runtime.
Use the MSVC Rust toolchain. Restart your terminal after installation.

**macOS:** Install Xcode Command Line Tools (`xcode-select --install`) and Rust.

**Debian/Ubuntu:** Install Rust and the native build dependencies:

```bash
sudo apt update
sudo apt install build-essential pkg-config curl wget file libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Extract this project, open a terminal in the `ippo-to-read` folder, then run:

```bash
npm install
npm test
npm run desktop
```

`npm run desktop` opens the real Tauri application. Its first native compilation
will download and compile Rust dependencies. Do not open `index.html` directly.

### Browser-only interface preview

```bash
npm run dev
```

Open the local address Vite prints, normally `http://127.0.0.1:1420`.
The browser preview uses fictional sample comics and local preview bookmarks.
It does **not** import real files or pretend to provide an encrypted vault.
Use the desktop command for those features.

### Build installers

```bash
npm run package
```

The Cargo workspace places build output in the root `target` directory.
Installer bundles are generated under `target/release/bundle` for the current
operating system. Build on each target platform; this project does not configure
cross-compilation, signing, notarization or automatic updates.

## What is implemented

| Feature | Behavior |
| --- | --- |
| Reading direction | Per-comic LTR/RTL. Arrow keys follow the chosen direction; images are not mirrored. |
| Reading modes | Paged and continuous vertical scrolling. Zoom from 60% to 160%. |
| Auto bookmarks | Page, normalized within-page scroll offset, zoom, mode and direction are saved. Progress writes are serialized, coalesced and flushed on normal reader/app exit. |
| Automatic shelves | Embedded metadata is preferred when available, then folder/filename parsing groups matching series with numeric volume/chapter ordering. A shelf/series counts as one comic; its files count as chapters/volumes. |
| Shelf view | Cover cards expand into a collection view with all imported chapters/volumes, progress and last-read highlighting. Shelves can use a custom managed image. |
| Continue reading | Resumes the most recently read item, even when you revisit an earlier volume. |
| Design | Light/dark/system theme, system typography, restrained motion, keyboard focus and reduced-motion support. |
| Shortcuts | Page turns, next/previous chapter, import, search, modes, fullscreen and private-library toggle. |
| Private library | Passphrase-gated encryption for managed pages/PDFs, covers and metadata including bookmarks. |
| Library management | Edit titles, series, volume/chapter, author, publisher, language, genres and medium; move items between normal/private libraries and remove managed copies. |
| Novel space | A separate quiet bookshelf and text reader for EPUB, text-heavy DOCX and UTF-8 TXT with themes, typography, chapter navigation and automatic position saving. |
| Library filters | Comics can be filtered as Manga, Manhwa, Manhua, Comic or Webtoon; novels live in their own tab. |
| Reading time | Counts only visible, focused, recently active reading time, stored locally per item with an all-time dashboard. |
| Music | Imported MP3 files are copied to managed local storage and can be played from comics or novels with saved playlists/repeat/volume settings. |
| Online series info | Optional normal-library lookups for MyAnimeList (via Jikan), ComicK tracker data, and embedded publisher/source information; successful results are cached locally for seven days. Private shelves never perform online lookups. |
| Watched folders | Normal-library folders are recursively rescanned for supported comics/novels; matching existing chapters are adopted instead of duplicated. Private libraries are manual-import only. |

### Supported imports

- **ZIP / CBZ:** JPEG, PNG, WebP and GIF pages, ordered naturally (`2` before `10`).
  This build enables stored/Deflate ZIP compression. Other compression methods,
  encrypted ZIPs, archive symlinks and nested archives are not supported.
- **PDF:** Canvas rendering with a locally bundled PDF.js worker and assets.
  Password-protected PDFs and XFA forms are not supported. PDFs initially have a
  generated title placeholder rather than a cover thumbnail. Page count is
  determined on first open.
- **Image folders:** One selected folder becomes one comic, including supported
  images in subfolders up to 16 levels deep. Symlinks are not followed.
- **JPG / JPEG / PNG / WebP / GIF:** Individual images can be imported as comics.
- **EPUB:** Reads package metadata, embedded cover art, spine-ordered HTML/XHTML
  text, common Calibre/EPUB3 series metadata, and opens readable books in Novel
  mode. Image-only EPUBs fall back to comic pages where possible.
- **DOCX:** Text-heavy documents become novels using paragraph/heading extraction
  plus core document metadata. Image-heavy documents fall back to embedded raster
  images in document order. This is **not** a Word page-layout renderer.
- **TXT:** UTF-8 plain-text books open in Novel mode.

**Not implemented:** Legacy `.doc`, CBR/RAR, 7z, faithful Word/PDF text reflow,
two-page spreads, horizontal scrolling, shortcut remapping, favorites,
biometric/keychain unlock, password changes, cloud sync, automatic software
updates, or a universal publisher-review API.

Export `.doc` to PDF in Word or LibreOffice, then import the PDF. The file
picker accepts `.doc` only so the app can show that explicit conversion message;
it never claims to read the binary DOC format.

### Import limits

A selected file can be at most 256 MiB; an individual raster page at most
32 MiB and 40 megapixels; and an expanded image comic at most 1 GiB. There is
no longer a 5,000-page application cap. ZIP inventory is limited to 20,000
entries, XML parts to 8 MiB, and batch file selection to 200 files. Suspicious
ZIP expansion ratios are rejected. These are practical security/resource limits,
not a formal parser sandbox.

Large PDFs are read into memory, but their page geometry is discovered gradually
in background batches and actual canvases are rendered only near the viewport.
Very large libraries/books may still require substantial memory and disk space.

## Reading and shortcuts

| Shortcut | Action |
| --- | --- |
| Left / Right | Previous/next according to LTR or RTL |
| Space / Shift+Space | Logical next/previous page; scroll mode moves one screen |
| Space twice | Next chapter/volume in the shelf |
| Shift+Space twice | Previous chapter/volume |
| Ctrl/Cmd+O | Import files |
| Ctrl/Cmd+Shift+O | Import an image folder |
| Ctrl/Cmd+F | Search the library |
| Ctrl/Cmd+1 / 2 | Paged / vertical scroll |
| R | Toggle LTR/RTL |
| F | Toggle fullscreen |
| Escape | Close a dialog or leave the reader |
| Ctrl+H | Open or lock the private library |
| Cmd+Shift+H on macOS | Alternative private-library shortcut |
| ? | Shortcut reference |

Command+H is intentionally **not** overridden on macOS. The Space double-tap
window is 280 ms; the single-tap action waits for it to expire. Key autorepeat
does not trigger double-Space chapter changes. Reader shortcuts pause while
an input or modal dialog is active. Ctrl+H can still lock an already-open
private view.

## How shelves work

These names become one shelf (one comic with multiple chapters/volumes):

```text
Chainsaw Man Vol 01.cbz
Chainsaw.Man.v02.pdf
Chainsaw_Man_Volume_03.zip
Chainsaw Man Chapter 10.5.cbz
```

Ippo first uses embedded metadata when it can: ComicInfo.xml for CBZ/ZIP, EPUB
package metadata, and DOCX core properties. Filename/folder heuristics are the
fallback. Bracketed scan tags are removed and explicit volume/chapter markers are parsed. Bare title numbers such
as "Area 88" are preserved. Ambiguous names can be corrected from a comic's
three-dot menu. Shelf names are compared case-insensitively with normalized
spacing. Mixed shelves list numbered volumes first, then loose chapters. For example, `Hajime no Ippo ch.1` and `Hajime no Ippo ch.2` are one manga shelf with two chapters, not two comics.

Open a shelf and choose **Change shelf image** to select a JPEG, PNG, WebP or GIF. Ippo resizes and copies the image into managed storage, so the source image can be moved or deleted after the success message. **Use chapter cover instead** removes the custom image. Private-library shelf images are encrypted.

## Where your files go

Imports are **copied into Ippo-managed storage**. Your original files are never
renamed, moved or deleted. ZIP pages are stored separately for reading; PDFs are
stored as document blobs. Private blobs are encrypted before they are written,
including inside the temporary import staging directory.

The application uses Tauri's per-app data directory for identifier
`com.ippotoread.app`. Typical locations are:

```text
Windows: %APPDATA%\com.ippotoread.app
macOS:   ~/Library/Application Support/com.ippotoread.app
Linux:   $XDG_DATA_HOME/com.ippotoread.app
         (usually ~/.local/share/com.ippotoread.app)
```

```text
library.sqlite       Public JSON records + encrypted private records + vault salt/verifier + managed custom shelf images
books/<random-id>/   Managed page/document/cover blobs
staging/<random-id>/ Temporary imports and privacy transfers
```

For a manual backup, **close the application first**, then copy the whole app-data
folder, not only the database. Keep the private-library passphrase separately.
Do not delete original comics until you have verified imports and backups.

## Private-library security

Press Ctrl+H and create a passphrase of at least 12 characters. Use a long,
unique, randomly generated passphrase rather than a short PIN. There is no default password or decryption backdoor. Entering twelve zeros in
the unlock field opens the destructive recovery screen: you may export the
still-encrypted vault first, or erase/reset the private library. A forgotten
passphrase cannot be used to recover plaintext private files.

The native code derives a 256-bit key with Argon2id (64 MiB memory, 3 passes,
1 lane, random 16-byte salt). AES-256-GCM encrypts every resource and private
metadata record using a fresh random nonce. Authenticated context binds each
ciphertext to its book ID and resource name. The primary Rust key is held in
zeroizing memory, not persisted as plaintext.

Private books are excluded from the normal library/search and require an
unlocked native session for listing, reading, modifying or deleting. The vault
locks after five minutes without user interaction, when the app loses focus
(except its own file picker), and on exit. The frontend conceals private content
on blur and revokes object URLs when private components unmount. Native
operations are serialized; locking can wait for an already-running operation
to release the database mutex. The UI concealment happens without that wait.

**Important boundaries:** The app does not hide or encrypt your original files,
OS file-picker history, external thumbnails, screenshots, backups, filesystem
sizes/counts, swap, hibernation images or a compromised device. Previously
public managed copies and database records may leave recoverable disk remnants.
Import directly into the unlocked private library when privacy matters.

This is an unaudited implementation, not a claim of production-grade or
forensic-proof secrecy. Read `SECURITY.md` before relying on the vault for
sensitive material. Bookmark flushes are best effort during focus loss; forced
termination or abrupt power loss can lose the most recent pending update.

## Project map

```text
src/App.tsx                   Library, shelf navigation, dialogs and session handling
src/components/Reader.tsx     Paged/scroll comic reader, lazy pages, anchor restoration and keys
src/components/NovelReader.tsx Dedicated text reader with themes and typography
src/components/NovelLibrary.tsx Quiet bookshelf and novel continue-reading view
src/components/Library.tsx    Shelf cards, continue cards and chapter lists
src/components/Dialogs.tsx   Preferences, edit, import report and vault forms
src/lib/logic.ts              Sorting, progress math, double-tap and save queue
src/lib/api.ts                Typed frontend/native bridge
src/lib/pdf.ts                PDF worker and geometry loading
src/lib/demo.ts               Browser-only fictional sample books
src/styles.css               Interface, dark mode and reduced motion
src-tauri/src/lib.rs          Native commands, file picker, auto-lock and lifecycle
crates/ippo-core/src/         Importer, naming, SQLite, encryption and core tests
crates/ippo-core/tests/       Archive, DOCX, folder and encrypted-content tests
scripts/copy-pdf-assets.mjs   Copies PDF.js assets locally during dev/build
.github/workflows/check.yml  Windows/macOS/Linux build-check workflow
```

## Metadata and network behavior

Ippo never uploads the comic/novel file itself for online series lookups. For
normal shelves with Online series info enabled, it sends the series title to
public read-only services and may display up to three source cards: MyAnimeList
through Jikan, ComicK tracker information, and the publisher/source description
embedded in your file. Providers can change or rate-limit their public endpoints,
so these cards are best-effort and never block reading. Successful results are
cached locally for seven days. Private shelves never make these lookups.

The metadata editor lets you correct classification and organization locally.
ComicInfo.xml genre hints can classify Manhwa, Manhua or Webtoon; otherwise Ippo
uses Manga/Comic defaults until you correct the type.

## Checks and maintenance

```bash
npm test                    # Reader-logic tests; runs with Node's built-in test runner
npm run typecheck           # Type check against installed dependency declarations
npm run build               # Type check + Vite production build
npm run test:native         # Rust core tests, without the desktop GUI requirements
npm run check:native        # Check the native Tauri application
npm run desktop             # Manual end-to-end testing
```

See `TESTING.md` for what was actually executed during authoring and the manual
acceptance checklist. The Rust tests and CI workflow are included, not claimed
as passing in an environment without Rust/dependency access.

Dependency ranges are declared rather than an invented lockfile. `npm install`
and Cargo create `package-lock.json` and `Cargo.lock` on first resolution.
Review and commit those files after a successful build, keep security updates
current, then use `npm ci` and `cargo ... --locked` for reproducible builds.

### Troubleshooting

**"cargo not found" or linker errors:** Install current stable Rust and the
platform build prerequisites, then restart the terminal. Some current native
plugins require Rust 1.90 or later; use `rustup update stable`.

**WebKit/GTK errors on Linux:** Install the system development packages above.
Use a desktop session for `npm run desktop`, not a headless-only machine.

**Browser says imports need the desktop app:** This is intentional. Use
`npm run desktop`, not only `npm run dev`.

**Private library locks when switching apps:** This is intentional. Files and
bookmarks already saved remain encrypted; press Ctrl+H to unlock again.

**Wrong shelf or wrong order:** Open the shelf, choose the comic's three-dot
menu and correct the shelf name, volume or chapter number.

**A file is rejected:** Read the import report. Convert unsupported Word/archive
formats to PDF or a normal ZIP/CBZ of images. Split files above the resource
limits rather than disabling validation blindly.

**Lost passphrase:** There is no recovery. Original files outside Ippo are not
changed, so they can be reimported into a new library. Back up the app-data folder
before changing/removing anything manually.

### Official implementation references

```text
Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
Tauri capabilities:  https://v2.tauri.app/security/capabilities/
Tauri commands:      https://v2.tauri.app/develop/calling-rust/
Tauri dialogs:       https://v2.tauri.app/plugin/dialog/
PDF.js examples:     https://mozilla.github.io/pdf.js/examples/
Rust AES-GCM:        https://docs.rs/aes-gcm/0.10.3/aes_gcm/
Rust Argon2:         https://docs.rs/argon2/0.5.3/argon2/
Vite setup:          https://vite.dev/guide/
```

Original project code is provided under the MIT license. Dependencies retain
their respective licenses; they are downloaded by npm/Cargo, not vendored here.

## v0.1.1 reader update

- Scroll mode now renders comic images edge-to-edge vertically with **zero inter-page gap**, which is important for manhwa/webtoon chapters split across image files.
- Scroll mode removes page shadows so image boundaries do not look like artificial panel breaks.
- The lazy-render window was increased to reduce page pop-in during fast scrolling while still unloading distant pages on long chapters.
- Comic images now use asynchronous image decoding to reduce main-thread stalls while scrolling.

## v0.1.5 comic cover shortcut

On **Your shelves**, left-click a comic card to open its quick menu. Choose **Add comic cover** to select a custom cover image. Ippo copies the selected image into its managed cover storage, so after the success message appears the original file can be removed from Desktop or Downloads. The same menu also offers **Open comic**, **Start / Continue reading**, and **Use chapter cover**.


## v0.1.6 right-click menu and page flip

Shelf cards now open normally with left-click and show their action menu with right-click. The reader also has an optional **Flip** control for a traditional page-turn effect in Paged mode. Flip is disabled while using continuous Scroll reading, and its turn direction follows LTR/RTL reading direction.

### v0.1.7 page flip stability
Paged-mode page flips now keep the destination page mounted throughout the animation to prevent the post-flip blink.

## v0.1.8 managed reading music

While a comic is open, a small music-note button appears at the top-right of the reader. It opens Ippo's reading-music panel.

- Import one or many MP3 files. Ippo copies each imported file into its own app-data `music` directory, so the source file can be deleted after the import succeeds.
- Play, pause, skip forward/back, and control volume without leaving the reader.
- Repeat modes cycle between Off, Repeat all, and Repeat one.
- Create multiple named playlists.
- Add songs to playlists, remove them from playlists, and move tracks up/down to control playback order.
- Playback remains alive when moving from one chapter to another because the music player is owned by the app shell rather than by an individual chapter reader.
- Removing a playlist does not remove its MP3 files. Removing a track from the music library removes Ippo's managed MP3 copy.

Music files are stored locally on this device. The music library is currently shared between the normal and private comic views and is not encrypted by the private-library vault.

## v0.2.0: music, private-library stability, and watched folders

- The music button is now always visible at the bottom-right of Ippo.
- Normal-library folders can be watched for CBZ, ZIP, PDF, EPUB, and DOCX chapter files. Ippo rescans automatically and copies new/changed chapters into managed storage. If a matching series + chapter/volume is already in the normal library from a manual import, the watcher adopts that existing chapter instead of creating a duplicate.
- Private-library imports remain manual by design. Successful private imports are encrypted managed copies and no longer depend on the source file.
- Private content is concealed immediately when Ippo loses focus; transient focus changes no longer instantly kick you out of the private library.
- Image-based EPUB import is supported. Legacy `.doc` still needs conversion to PDF.

See `UPDATE-v0.2.0.md` for details.


## Private-library recovery

If a configured private-library passphrase is forgotten, type `000000000000` (12 zeros) in the passphrase field. Ippo offers an encrypted backup or a destructive vault reset. The recovery code cannot decrypt files without the old passphrase.


## v0.2.2: watched-folder duplicate adoption

When a watched folder contains chapters that were already manually imported, Ippo now links those source files to the existing library entries instead of importing them again. Matching uses the normalized series name plus chapter/volume identity, so `Hajime no Ippo ch.1` already in the library remains one chapter when its source folder is later watched. New chapter numbers in the same folder still import normally.

See `UPDATE-v0.2.2.md` for details.

### v0.3.1 comic type repair

If older imports appear under the generic **Comic** filter because their files do not contain origin metadata, use **Identify types** in the Comics library. Ippo checks an exact title match against ComicK origination first and MyAnimeList/Jikan second, then updates the whole shelf to Manga, Manhwa or Manhua. Private shelves never use online identification.