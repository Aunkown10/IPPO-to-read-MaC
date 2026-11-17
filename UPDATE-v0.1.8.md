# Ippo to Read v0.1.8

## Managed reading music

This release adds a persistent local MP3 player designed for reading sessions.

### Reader music button

A small music-note control is shown in the reader. It opens a compact player with play/pause, previous/next, volume, repeat controls, playlists, and track management.

### Managed MP3 imports

Imported MP3s are copied to Ippo's app-data storage. The original MP3 is never moved or modified. After Ippo reports that the import completed, deleting the original Desktop/Downloads copy does not affect playback in Ippo.

Each MP3 is limited to 150 MB and up to 200 files can be selected in one import.

### Playlists and ordered playback

Users can create multiple playlists, add tracks to them, remove tracks, and move tracks up or down. The visible playlist order is the playback order. Repeat modes are Off, All, and One.

### Playback lifetime

The audio player is mounted at app-shell level, so advancing from one comic chapter to the next does not tear down the active song.

### Storage note

Reading music is a device-local feature and is not encrypted with the private comic vault in v0.1.8.
