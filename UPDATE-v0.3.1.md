# Ippo to Read v0.3.1 - Comic type identification fix

v0.3.1 fixes shelves falling back to **Comic** when a CBZ/ZIP/PDF does not embed enough origin metadata to distinguish manga, manhwa and manhua.

## What changed

- Added online type identification for otherwise-unknown Comic shelves.
- ComicK origination/country is preferred when an exact normalized title match is found: Japan -> Manga, Korea -> Manhwa, China -> Manhua.
- MyAnimeList/Jikan is used as a fallback when it explicitly labels the matching work as Manga, Manhwa or Manhua.
- Added an **Identify types** action beside the library filters so an existing v0.3.0 library can be repaired without re-importing files.
- New normal-library imports and watched-folder imports that still have the generic Comic type are identified automatically when Online series info is enabled.
- Identification only changes the Type field for all chapters/volumes on that shelf. It does not rename, move, delete, or re-import files.
- Private Library never performs online identification.
- Exact normalized title matching is required before an online result can change a shelf, reducing accidental matches.

## Existing libraries

Open **Comics**, make sure **Settings -> Online series info** is enabled, then click **Identify types**. Unknown shelves that can be matched confidently will move into Manga / Manhwa / Manhua filters immediately.

If a title cannot be matched confidently, it stays Comic and can still be corrected through Edit metadata.
