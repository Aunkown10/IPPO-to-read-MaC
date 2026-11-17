# Validation record and acceptance checklist

## Executed during source authoring

- **27 JavaScript/TypeScript reader-logic tests passed**, using Node 22.16.0 and
  `node --experimental-strip-types --test tests/*.test.ts`.
- **16 TypeScript/TSX files passed a syntax/transpilation diagnostic check**
  with the available TypeScript compiler. This is not the same as a full type
  check against real installed React, Tauri, Vite and PDF.js declarations.

The logic tests cover natural volume/chapter order, decimal chapters, shelf
normalization, last-read selection, paged/scroll percentages, RTL navigation,
single/double-Space timing, cancellation and serialized bookmark writes,
including retry after failed saves.

## Not executed in that environment

The environment had no Rust/Cargo toolchain and could not resolve external
package hosts. Consequently these were **not verified**:

- npm dependency resolution, a full dependency-backed TypeScript check, or a
  Vite production build;
- Rust compilation and the included Rust unit/integration tests;
- native Windows/macOS/Linux launch, dialogs, real imports, PDF rendering,
  vault lifecycle, installer packaging, signing or notarization;
- independent security auditing, performance benchmarks, crash/power-loss
  durability, or compatibility with every comic/document variant.

The supplied code and CI workflow are intended to make those checks repeatable.
They are not a claim that unrun checks passed. No compiled installer is included.

## Run after installing dependencies

```bash
npm install
npm test
npm run typecheck
npm run build
cargo test -p ippo-core
cargo check -p ippo-desktop
npm run desktop
```

The Rust tests include filename parsing; nonce freshness and authentication;
private/public isolation; encrypted stored bytes and metadata; wrong passwords;
reopen/resume; idle expiry; transfer; invalid progress; archive order and path
traversal rejection; image folders; DOCX relationship ordering; explicit legacy
DOC rejection; and encrypted-page tamper detection.

## Manual release acceptance

1. Import ZIP/CBZ pages named 1, 2 and 10. Verify display order, cover and title.
2. Import volumes 1, 2 and 10 plus chapter 10.5 of a series. Open its shelf;
   correct one mistaken name in the editor and verify regrouping.
3. Read in LTR and RTL. Verify arrows change logical pages correctly without
   mirroring images. Verify Space remains logical next in both directions.
4. Single Space should turn once after the detection window. Double Space
   should change chapter without first turning a page. Repeat with Shift.
5. Stop halfway through a long image page in scroll mode. Close normally,
   reopen, resize, change zoom, and confirm the same content is visible.
6. Open a mixed-page-size PDF, then repeat the bookmark test. Inspect the local
   worker/CMap/font/WASM requests and verify no remote asset is needed.
7. Import a DOCX whose drawing relationship order differs from media filename
   order. Verify the sequence; confirm its layout limitations are disclosed.
8. Import unsupported DOC/RAR/7z, corrupted files, an empty ZIP, unsafe ZIP
   paths, oversized pages and a password-protected PDF. Check clear errors and
   that originals remain unchanged; failed imports should not create records.
9. Create the private library. Import directly into it. Lock. Confirm normal
   search, recent cards and native content reads cannot reveal private books.
10. Unlock with a wrong password, then a correct one after the retry delay.
    Verify blur/idle/manual/exit locking, including while a reader/dialog is
    open. Verify the native import picker is an exception to blur locking.
11. Transfer a book public-to-private and back. Verify content and progress.
    Confirm warnings about originals and disk remnants are shown.
12. Inspect closed app-data files: private blobs should not be images/PDFs and
    private metadata must not contain its titles in plaintext. Alter a private
    blob and confirm authentication failure rather than rendering corrupted
    plaintext. Do not conduct this test on your only copy of a library.
13. Test disk-full/permission errors during import and bookmark saving. Normal
    exit should not silently claim a failed bookmark was saved. Forced kill
    may lose a pending update; recover with originals/backups as needed.
14. Exercise keyboard focus, modal Escape behavior, system/dark/light themes,
    reduced motion and the minimum supported window size.
15. Test Windows, macOS and Linux installers on clean machines. Keep all build
    logs, dependency lockfiles and the actual results with the release.
