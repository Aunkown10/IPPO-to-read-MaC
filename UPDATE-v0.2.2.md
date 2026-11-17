# Ippo to Read v0.2.2 — Watched-folder duplicate adoption

## Fixed

- Choosing a watched folder no longer creates duplicate library entries for chapters/volumes that were already imported manually.
- Ippo compares the watched filename's normalized series and chapter/volume identity against the existing normal library.
- A match is **adopted** by the watcher: the existing Book ID, progress, cover relationship, and library entry remain in place, and the watched source path is linked to it.
- Only genuinely new chapter/volume identities are imported as new library entries.
- Multiple watched folders encountered in the same sync pass also share the same in-memory identity list, preventing a second watched folder from creating the same logical chapter again.
- Sync notifications now distinguish newly imported chapters from existing chapters linked without duplicates.

## Example

Before watching a folder, the library already contains:

- `Hajime no Ippo ch.1`
- `Hajime no Ippo ch.2`

The selected watched folder contains:

- `Hajime no Ippo ch.1.cbz`
- `Hajime no Ippo ch.2.cbz`
- `Hajime no Ippo ch.3.cbz`

After the first watched-folder sync the library contains exactly **3 chapters**, not 5. Chapters 1 and 2 are linked to their existing entries; chapter 3 is imported.

## Notes

The matching logic is intentionally based on comic identity rather than filesystem path, because a manual import may have happened before Ippo knew which folder would later be watched. If the user manually edits a chapter's shelf/title/number so it no longer matches the source filename, it can be treated as a distinct item.
