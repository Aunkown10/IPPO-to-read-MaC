import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Book, BookMetadata, ClassificationDecision, ClassificationLookup, EditBook, ImportReport, Medium, MusicPlaylist, MusicSnapshot, MusicTrack, NovelDocument, PageSize, Progress, SeriesReviewBundle, TransferResult, VaultResetResult, VaultStatus, WatchedFolder, WatchSyncResult } from "../types";
import { demoCover, demoEdit, demoList, demoPage, demoRemove, demoSave } from "./demo";

export const previewMode = !isTauri();
const desktopOnly = (): never => { throw new Error("This feature needs the desktop app. Run npm run desktop; the browser is a sample-only preview."); };
export const api = {
  classificationBooks: async (id: string): Promise<Book[]> => previewMode ? demoList().filter((b) => b.series === demoList().find((v) => v.id === id)?.series) : invoke("classification_books", { id }),
  classificationSources: async (id: string, query: string): Promise<ClassificationLookup> => previewMode ? { responses: [], warnings: ["Online classification requires the desktop app."] } : invoke("classification_sources", { id, query }),
  applyClassification: async (id: string, decision: ClassificationDecision): Promise<number> => previewMode ? desktopOnly() : invoke("apply_classification", { id, decision }),
  rereadComicMetadata: async (id: string): Promise<Book[] | null> => previewMode ? desktopOnly() : invoke("reread_comic_metadata", { id }),
  listBooks: async (privateView: boolean): Promise<Book[]> => previewMode ? privateView ? [] : demoList() : invoke("list_books", { private: privateView }),
  importBooks: async (folder: boolean, privateView: boolean): Promise<ImportReport> => previewMode ? desktopOnly() : invoke("import_books", { folder, private: privateView }),
  importNovels: async (privateView: boolean): Promise<ImportReport> => previewMode ? desktopOnly() : invoke("import_novels", { private: privateView }),
  readPage: async (id: string, index: number): Promise<ArrayBuffer> => previewMode ? demoPage(id, index) : invoke("read_page", { id, index }),
  readNovel: async (id: string): Promise<NovelDocument> => previewMode ? { chapters: [{ title: "Preview", text: "Novel mode is available in the desktop app.", wordCount: 9 }], wordCount: 9 } : invoke("read_novel", { id }),
  addReadingTime: async (id: string, seconds: number): Promise<number> => previewMode ? seconds : invoke("add_reading_time", { id, seconds }),
  seriesReviews: async (series: string, metadata: BookMetadata): Promise<SeriesReviewBundle> => previewMode ? { cards: [], matchedTitle: series, warnings: [], suggestedMedium: null, classificationSource: "" } : invoke("series_reviews", { series, metadata }),
  setSeriesMedium: async (series: string, medium: Exclude<Medium, "novel">): Promise<number> => previewMode ? 0 : invoke("set_series_medium", { series, medium }),
  readCover: async (id: string): Promise<Blob> => new Blob([previewMode ? demoCover(id) : await invoke<ArrayBuffer>("read_cover", { id })], { type: previewMode ? "image/svg+xml" : "image/jpeg" }),
  readShelfCover: async (series: string, privateView: boolean): Promise<Blob> => {
    if (previewMode) throw new Error("No custom shelf image in preview mode");
    return new Blob([await invoke<ArrayBuffer>("read_shelf_cover", { series, private: privateView })], { type: "image/jpeg" });
  },
  setShelfCover: async (series: string, privateView: boolean): Promise<boolean> => previewMode ? desktopOnly() : invoke("set_shelf_cover", { series, private: privateView }),
  removeShelfCover: async (series: string, privateView: boolean): Promise<boolean> => previewMode ? false : invoke("remove_shelf_cover", { series, private: privateView }),
  saveProgress: async (id: string, progress: Progress): Promise<void> => previewMode ? demoSave(id, progress) : invoke("save_progress", { id, progress }),
  setPdfPages: async (id: string, pages: PageSize[]): Promise<void> => previewMode ? undefined : invoke("set_pdf_pages", { id, pages }),
  editBook: async (id: string, edit: EditBook): Promise<Book> => previewMode ? demoEdit(id, edit) : invoke("edit_book", { id, edit }),
  removeBook: async (id: string): Promise<string | null> => { if (previewMode) { demoRemove(id); return null; } return invoke("remove_book", { id }); },
  transferBook: async (id: string, privateView: boolean): Promise<TransferResult> => previewMode ? desktopOnly() : invoke("transfer_book", { id, private: privateView }),
  vaultStatus: async (): Promise<VaultStatus> => previewMode ? { configured: false, unlocked: false } : invoke("vault_status"),
  createVault: async (passphrase: string): Promise<void> => previewMode ? desktopOnly() : invoke("create_vault", { passphrase }),
  unlockVault: async (passphrase: string): Promise<void> => previewMode ? desktopOnly() : invoke("unlock_vault", { passphrase }),
  lockVault: async (): Promise<void> => previewMode ? undefined : invoke("lock_vault"),
  touchVault: async (): Promise<void> => previewMode ? undefined : invoke("touch_vault"),
  exportVaultBackup: async (): Promise<string | null> => previewMode ? desktopOnly() : invoke("export_vault_backup"),
  resetVault: async (): Promise<VaultResetResult> => previewMode ? desktopOnly() : invoke("reset_vault"),
  onVaultLocked: async (callback: () => void): Promise<() => void> => previewMode ? () => {} : listen("vault-locked", callback),
  onClose: async (callback: () => Promise<void>): Promise<() => void> => previewMode ? () => {} : getCurrentWindow().onCloseRequested(async (event) => { event.preventDefault(); await callback(); }),
  quit: async (): Promise<void> => previewMode ? undefined : invoke("quit_app"),


  watchedFolders: async (): Promise<WatchedFolder[]> => previewMode ? [] : invoke("list_watched_folders"),
  watchComicFolder: async (): Promise<WatchSyncResult> => previewMode ? desktopOnly() : invoke("watch_comic_folder"),
  unwatchComicFolder: async (id: string): Promise<void> => previewMode ? desktopOnly() : invoke("unwatch_comic_folder", { id }),
  syncWatchedFolders: async (): Promise<WatchSyncResult> => previewMode ? { imported: [], matchedExisting: 0, errors: [] } : invoke("sync_watched_folders"),
  onLibraryUpdated: async (callback: () => void): Promise<() => void> => previewMode ? () => {} : listen("library-updated", callback),

  musicSnapshot: async (): Promise<MusicSnapshot> => previewMode ? { tracks: [], playlists: [] } : invoke("music_snapshot"),
  importMusic: async (): Promise<MusicTrack[]> => previewMode ? desktopOnly() : invoke("import_music"),
  readMusicTrack: async (id: string): Promise<Blob> => {
    if (previewMode) return desktopOnly();
    return new Blob([await invoke<ArrayBuffer>("read_music_track", { id })], { type: "audio/mpeg" });
  },
  createPlaylist: async (name: string): Promise<MusicPlaylist> => previewMode ? desktopOnly() : invoke("create_music_playlist", { name }),
  deletePlaylist: async (id: string): Promise<void> => previewMode ? desktopOnly() : invoke("delete_music_playlist", { id }),
  setPlaylistTracks: async (id: string, trackIds: string[]): Promise<void> => previewMode ? desktopOnly() : invoke("set_music_playlist_tracks", { id, trackIds }),
  deleteMusicTrack: async (id: string): Promise<void> => previewMode ? desktopOnly() : invoke("delete_music_track", { id }),
  fullscreen: async (): Promise<void> => {
    if (previewMode) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } else {
      const window = getCurrentWindow(); await window.setFullscreen(!(await window.isFullscreen()));
    }
  },
};
