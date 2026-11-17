# Ippo to Read v0.1.6

## Right-click shelf actions

- Left-clicking a shelf now opens it normally.
- Right-clicking anywhere on a shelf card opens the quick action menu.
- The quick menu still contains Open comic, Start/Continue reading, Add comic cover, and Use chapter cover.

## Optional page flip reading

- Added a **Flip** toggle to the reader toolbar.
- Flip mode works only while **Paged** reading is active.
- In **Scroll** mode the Flip control is disabled and no page-turn animation runs.
- The page-turn direction follows the selected LTR/RTL reading direction.
- Flip preference is remembered locally for future reader sessions.
- The existing reading-settings lock also locks the Flip toggle.
- Reduced-motion system settings collapse the animation through the app's existing accessibility rule.

## Validation

- 30/30 logic tests pass, including LTR/RTL page-turn direction tests.
- Full dependency-backed TypeScript/Tauri build validation could not be completed in the generation environment because dependency installation timed out.
