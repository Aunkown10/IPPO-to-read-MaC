# Ippo to Read v0.2.0

This update makes three larger changes:

- **Reading music is now visible everywhere.** The music button is always available at the bottom-right of the app, not only while a reader page is open.
- **Private-library focus handling is more stable.** The private UI is concealed immediately when Ippo loses focus, but brief focus transitions no longer destroy the vault session instantly. The native key is dropped after two continuous seconds out of focus or five minutes idle. Native file pickers are excluded from that focus-lock timer.
- **Watched comic folders.** The normal library can watch one or more folders. Choose a folder once and Ippo scans it recursively for CBZ, ZIP, PDF, EPUB, and DOCX comic files. New or changed files are detected every few seconds, copied into managed storage, and grouped into shelves using the normal title parser. Private-library files are deliberately excluded from folder watching and must be imported manually.

Manual private imports continue to create encrypted managed copies. After Ippo confirms a successful import, the source file is no longer required by Ippo. Deleting the original file is the user's choice; Ippo cannot erase operating-system recent-file history, backups, or other copies.

Legacy `.doc` remains unsupported; export it to PDF first. EPUB support is aimed at image-based comic/manga EPUBs.
