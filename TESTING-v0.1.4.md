# v0.1.4 targeted checks

After applying the patch on Windows:

```powershell
npm.cmd test
npm.cmd run desktop
```

Verify these cases:

1. Import `Hajime no Ippo ch.1.cbz` and `Hajime no Ippo ch.2.cbz`. The library should show **1 comic** and the shelf should show **2 chapters**.
2. Import two chapters from a second series. The library should show **2 comics** and **4 chapters / volumes** total.
3. Open a shelf, choose **Change shelf image**, pick a JPEG/PNG/WebP/GIF, and confirm the new shelf image appears on the shelf card and detail view.
4. Close Ippo, delete or move the source image, reopen Ippo, and confirm the custom shelf image still appears.
5. Use **Use chapter cover instead** and confirm the custom image is removed.
6. Repeat steps 3-5 in the private library and confirm the image is unavailable while the private library is locked.
