# Ippo to Read v0.3.7 — macOS build from Windows

This release adds `.github/workflows/macos-build.yml` for a manually triggered Apple Silicon macOS build using GitHub Actions. No Mac is required to request the build.

## Steps

1. Create a new GitHub repository (private is fine).
2. Upload **the contents of the `ippo-to-read` project folder** to the repository root. The root must contain `package.json`, `Cargo.toml`, `src-tauri/`, `src/`, and `.github/workflows/macos-build.yml`. Do not upload the Windows `target/` or `node_modules/` directories.
3. Open the repository on GitHub and choose **Actions** → **Build Ippo for macOS** → **Run workflow** → **Run workflow**.
4. Wait for the build job to finish. Under the completed run, download the `Ippo-to-Read-v0.3.7-macOS` artifact from **Artifacts**.
5. Extract the artifact ZIP. The `.dmg` is the macOS installer image. Test it on an Apple Silicon Mac.

## Notes

- The initial workflow builds on `macos-15`, targeting Apple Silicon (ARM64). Intel Mac support needs a separate build/runner or universal binary configuration.
- Builds are **not signed or notarized**. macOS Gatekeeper may block or warn about installation; public distribution needs proper Developer ID signing and notarization.
- This project previously built on Windows. We have **not verified** the native macOS build here. Platform-specific Rust/API issues may still require fixes based on GitHub Actions logs.
- The original source archive contained a PDF.js TypeScript typing issue in `src/lib/pdf.ts`. This package removes unsupported `getDocument()` options to unblock the frontend build.
- The bundle identifier `com.ippotoread.app` has an upstream Tauri warning because it ends in `.app`. This patch leaves it unchanged to avoid changing the application's storage identity. Review it before shipping publicly.
- Do not commit private library files, passwords, `node_modules`, or `target` build outputs.
