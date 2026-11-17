# v0.2.0 validation

Validated in this environment:
- Existing TypeScript logic suite: 30/30 passing.
- Update/package structure and source diff inspected.

Not executable in this environment:
- Rust/Tauri native compilation (`cargo` is not installed here).
- Full dependency-backed TypeScript typecheck (project node_modules/type packages are not installed here).

Run locally on Windows after applying the patch:

```powershell
npm.cmd test
npm.cmd run desktop
```

For a deeper native check:

```powershell
npm.cmd run test:native
npm.cmd run check:native
```
