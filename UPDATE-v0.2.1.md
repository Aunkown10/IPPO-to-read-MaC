# Ippo to Read v0.2.1 — Private-library recovery

- Typing `000000000000` (12 zeros) into the configured private-library passphrase field opens recovery instead of attempting an unlock.
- Recovery can save an **encrypted backup** of the locked vault before any destructive action. The backup remains protected by the old passphrase; this is not an encryption bypass.
- Recovery can destructively reset Ippo's managed private library and remove the old passphrase verifier, after a second confirmation. The user can then create a new passphrase.
- Keyboard Shortcuts now documents the 12-zero recovery code.
- Normal-library data is preserved during a vault reset.

## Security note

A forgotten passphrase cannot be used to decrypt private files. The backup option preserves encrypted data in case the old passphrase is remembered later. Reset removes Ippo's private-library records and makes a best-effort deletion of directly identifiable encrypted managed files. SSD/filesystem remnants, external backups, Recycle Bin data, and older transferred-in storage that cannot be identified safely while locked are not guaranteed to be physically erased.
