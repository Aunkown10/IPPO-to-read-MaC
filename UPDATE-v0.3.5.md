# Ippo to Read v0.3.5

This patch focuses on novel-file reliability and very large documents.

## EPUB extraction

The EPUB reader is now more tolerant of real-world books. It now handles percent-encoded and case-varied archive paths, BOM-marked UTF-16 package files, XHTML that contains ordinary HTML entities or slightly malformed markup, missing/odd spine data, and a final fallback scan of HTML/XHTML reading files. Strict XML parsing is still preferred when the EPUB is clean.

## PDF novels

PDF is now offered in the Novels import picker. A PDF imported from the Novels tab is classified into the novel bookshelf but remains fixed-layout and uses the PDF renderer instead of pretending the text can always be reflowed. A coverless PDF novel receives the same generated white title cover as other coverless novels.

## No 5,000-page app cap

The old 5,000-page application limit was removed for image books and PDFs. ZIP safety limits such as the archive-entry ceiling and per-file decompression/image-size checks remain; those are security protections rather than a reading-page limit.

## Gradual PDF loading

PDF opening no longer waits for geometry from every page. Ippo opens after warming the first few pages, creates lightweight placeholders for the rest, and resolves page dimensions in small background batches. Actual PDF canvases were already viewport-lazy and remain so. When background geometry loading completes, the page map is cached for future opens.

## Validation

The existing 73 frontend logic/classification tests pass in the build environment. Two native EPUB helper tests were added for encoded paths and tolerant broken-XHTML/entity extraction. The build environment does not contain Rust/Cargo, so the native Rust tests and Windows/Tauri compilation still need to run on the development PC.
