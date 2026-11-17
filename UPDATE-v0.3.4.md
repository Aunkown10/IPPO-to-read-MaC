# Ippo to Read v0.3.4

## Coverless novel visibility
- Novels without embedded artwork now render a simple white cover with the novel title in black text.
- The author is shown when metadata provides one.
- The fallback is rendered locally; no internet request is needed.

## Novel import correctness
- Fixed a bug where the Novel importer could accept an EPUB that fell back to comic/image mode and still report it as a successfully imported novel.
- Novel imports now verify that the resulting library record is actually Novel mode.
- If readable text cannot be extracted, the mismatched record is removed and the import dialog explains the failure instead of leaving an apparently missing novel.
