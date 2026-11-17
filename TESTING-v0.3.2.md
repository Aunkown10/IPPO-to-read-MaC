# Verification log - 0.3.2

## Executed in the authoring environment

`npm test`: 73 passed, 0 failed. See `tests/classification-validation.txt` for the actual output. Fixtures deliberately use fictional titles and documented response shapes. They are not downloaded results from the user's real manga.

`tsc -p tests/tsconfig.classification.json`: passed. This is strict dependency-independent checking of the classifier and shared models, not a full React/Tauri build.

TypeScript transpile diagnostics: 22 .ts/.tsx source and test files checked; zero syntax errors. This is not type validation against installed React or Tauri definitions.

JSON/TOML configuration parsing and ZIP integrity: checked during packaging.

## Could not execute here

- Cargo / rustc are not installed.
- An ordinary npm registry request failed DNS resolution; an offline npm install failed because the required packages were not cached.
- The complete frontend typecheck/build and native Windows compile have NOT been claimed as passing.
- No live catalog match and no classification of the user's actual chapter archive have been verified.

## Run on the Windows development machine

From the folder containing package.json, run `verify-update.cmd`, or use:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:native
npm.cmd run check:native
```

Only after these checks and a backup, launch with `npm.cmd run desktop`.

## Manual regression checks

- Recheck a normal metadata-free comic. Missing metadata is visible; an offline API does not turn it into Comic.
- Import a tagged Manhwa with long-strip pages. Manhwa and Webtoon / long-strip filters should BOTH find it.
- Import a Japanese original in long-strip layout. It remains Manga, not automatically Manhwa.
- Use a different spelling/English title and inspect alternate-title candidates.
- Confirm a type once for a two-chapter shelf. Both chapters update. Reopen the app; the choice remains. Import chapter three; it inherits the pinned choice.
- Online results must not overwrite that pinned choice.
- Re-read ComicInfo from an original CBZ. Counts, IDs, page position and custom cover remain unchanged.
- With Private Library open, verify no online classification action is enabled and a private ID is rejected by the online backend command.
- Simulate timeout/429/provider schema errors. Readable diagnostics should appear, not an unsupported confident origin.
- Read a comic with flip/scroll and play music. This patch does not change either reader or music code.
