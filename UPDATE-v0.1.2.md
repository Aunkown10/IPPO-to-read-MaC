# Ippo to Read v0.1.2

This update focuses on continuous-scroll manga/manhwa reading and reader controls.

## Fixed

- Scroll mode no longer relies on stored archive dimensions after an image has decoded. The actual image aspect ratio controls its displayed height, preventing false white space when metadata dimensions are inaccurate.
- Adjacent scroll pages overlap by one CSS pixel to hide browser/DPI sub-pixel seams between vertically stitched manhwa panels.
- Scroll images render at their natural vertical size rather than being forced into a fixed-height box.
- Lazy pages keep a placeholder aspect ratio while off-screen so virtualization remains stable.

## Added

- A lock/unlock button beside the reading mode and RTL/LTR controls.
- While locked, Paged/Scroll and RTL/LTR cannot be changed accidentally, including with Ctrl+1, Ctrl+2, or R.
- Page navigation, scrolling, zoom, fullscreen, and chapter navigation still work while the reading settings are locked.

## Run after replacing the files

```powershell
npm.cmd run desktop
```

You do not need to reinstall Node, Rust, WebView2, or Visual Studio Build Tools.
