# v0.3.0 validation notes

Executed in the authoring environment:

- `npm test`: 30/30 existing reader/library logic tests passed.
- TypeScript/TSX syntax transpile check: passed for `src/` and `tests/`.
- JSON configuration parse checks: run before packaging.

Not executable in the authoring environment:

- Full `npm install`/dependency-backed `tsc` and Vite build (dependency install timed out).
- Rust `cargo check` / native tests (Rust toolchain is not installed in this environment).
- Live ComicK/Jikan lookups from the packaged Windows app.

Before calling a Windows build release-ready, run:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run typecheck
cargo check -p ippo-desktop
cargo test -p ippo-core
npm.cmd run desktop
```

Manual checks should cover EPUB/DOCX/TXT novel import, novel resume position,
reading-time idle pause, metadata filtering/editing, watched-folder TXT/EPUB
updates, normal/private separation, online lookup disabled/private behavior, and
music continuity while switching between Comics and Novels.
