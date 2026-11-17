# Ippo to Read v0.1.4

## Series-aware comic counting

Ippo now treats a shelf/series as one comic or manga. Files such as:

- `Hajime no Ippo ch.1.cbz`
- `Hajime no Ippo ch.2.cbz`

are one comic shelf with two chapters, not two comics. The library counter therefore reports the number of series/shelves as comics and separately reports the number of chapter/volume files.

The filename parser already strips `ch`, `chapter`, `vol`, `volume`, `v`, and similar numbering tokens when deriving the common series name; v0.1.4 adds a regression test for the `ch.1` / `ch.2` case and updates the UI so those members are described as chapters/volumes rather than separate comics.

## Custom shelf images

Open a shelf and choose **Change shelf image** beneath its cover. Ippo copies and normalizes the selected JPEG, PNG, WebP, or GIF into its own managed library storage. After the success message appears, the original image file is no longer required and may be deleted or moved.

Use **Use chapter cover instead** to remove the custom shelf image.

Private-library shelf images are encrypted before being written to the library database and require the private library to be unlocked before they can be read or changed.
