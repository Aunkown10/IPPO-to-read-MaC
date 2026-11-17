mod classification;
use ippo_core::{Book, BookMetadata, EditBook, ImportReport, Medium, MusicPlaylist, MusicSnapshot, MusicTrack, NovelDocument, PageSize, Progress, ReviewCard, SeriesReviewBundle, Store, TransferResult, VaultResetResult, VaultStatus, WatchedFolder, WatchSyncResult};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone)]
struct Backend(Arc<Mutex<Store>>);
#[derive(Clone)]
struct DialogGate(Arc<AtomicBool>);
struct DialogGuard(Arc<AtomicBool>);
impl Drop for DialogGuard { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }

type ApiResult<T> = Result<T, String>;

async fn work<T: Send + 'static>(state: Backend, action: impl FnOnce(&mut Store) -> anyhow::Result<T> + Send + 'static) -> ApiResult<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = state.0.lock().map_err(|_| "Library state is unavailable; restart the app".to_string())?;
        action(&mut store).map_err(|e| format!("{e:#}"))
    }).await.map_err(|_| "The library operation was interrupted".to_string())?
}

#[tauri::command]
async fn list_books(state: State<'_, Backend>, private: bool) -> ApiResult<Vec<Book>> {
    work(state.inner().clone(), move |s| s.list_books(private)).await
}
#[tauri::command]
async fn read_page(state: State<'_, Backend>, id: String, index: usize) -> ApiResult<tauri::ipc::Response> {
    let bytes = work(state.inner().clone(), move |s| s.read_page(&id, index)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
async fn read_cover(state: State<'_, Backend>, id: String) -> ApiResult<tauri::ipc::Response> {
    let bytes = work(state.inner().clone(), move |s| s.read_cover(&id)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}


#[tauri::command]
async fn read_novel(state: State<'_, Backend>, id: String) -> ApiResult<NovelDocument> {
    work(state.inner().clone(), move |s| s.read_novel(&id)).await
}

#[tauri::command]
async fn add_reading_time(state: State<'_, Backend>, id: String, seconds: u64) -> ApiResult<u64> {
    work(state.inner().clone(), move |s| s.add_reading_time(&id, seconds)).await
}

fn short_review(input: &str) -> String {
    let clean = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= 650 { return clean; }
    clean.chars().take(647).collect::<String>() + "..."
}

fn normalized_title(input: &str) -> String {
    input.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn title_matches_query(query: &str, item: &serde_json::Value) -> bool {
    let wanted = normalized_title(query);
    if wanted.is_empty() { return false; }
    let mut candidates = Vec::new();
    for key in ["title", "title_english", "title_japanese"] {
        if let Some(value) = item.get(key).and_then(|v| v.as_str()) { candidates.push(value); }
    }
    for key in ["titles", "md_titles"] {
        if let Some(values) = item.get(key).and_then(|v| v.as_array()) {
            for value in values {
                if let Some(title) = value.get("title").and_then(|v| v.as_str()) { candidates.push(title); }
            }
        }
    }
    if let Some(values) = item.get("title_synonyms").and_then(|v| v.as_array()) {
        candidates.extend(values.iter().filter_map(|v| v.as_str()));
    }
    candidates.into_iter().any(|candidate| normalized_title(candidate) == wanted)
}

fn medium_from_mal_type(value: &str) -> Option<Medium> {
    match value.trim().to_ascii_lowercase().as_str() {
        "manga" => Some(Medium::Manga),
        "manhwa" => Some(Medium::Manhwa),
        "manhua" => Some(Medium::Manhua),
        _ => None,
    }
}

fn medium_from_country(value: &str) -> Option<Medium> {
    match value.trim().to_ascii_lowercase().as_str() {
        "jp" | "jpn" | "japan" => Some(Medium::Manga),
        "kr" | "kor" | "korea" | "south korea" => Some(Medium::Manhwa),
        "cn" | "chn" | "china" => Some(Medium::Manhua),
        _ => None,
    }
}

#[tauri::command]
async fn series_reviews(series: String, metadata: BookMetadata) -> ApiResult<SeriesReviewBundle> {
    let query = series.trim().to_string();
    if query.is_empty() { return Err("Series name is empty".into()); }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(9))
        .user_agent("Ippo-to-Read/0.3.2 (+local desktop reader)")
        .build().map_err(|e| e.to_string())?;
    let mut bundle = SeriesReviewBundle::default();

    // MyAnimeList data through Jikan's read-only public API.
    match client.get("https://api.jikan.moe/v4/manga").query(&[("q", query.as_str()), ("limit", "20")]).send().await {
        Ok(response) if response.status().is_success() => {
            if let Ok(value) = response.json::<serde_json::Value>().await {
                if let Some(item) = value.get("data").and_then(|v| v.as_array()).and_then(|a| a.iter().find(|item| title_matches_query(&query, item))) {
                    if title_matches_query(&query, item) {
                        if let Some(medium) = item.get("type").and_then(|v| v.as_str()).and_then(medium_from_mal_type) {
                            bundle.suggested_medium = Some(medium);
                            bundle.classification_source = "MyAnimeList".into();
                        }
                    }
                    let id = item.get("mal_id").and_then(|v| v.as_u64());
                    let title = item.get("title").and_then(|v| v.as_str()).unwrap_or(&query).to_string();
                    let score = item.get("score").and_then(|v| v.as_f64());
                    let mut body = item.get("synopsis").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    bundle.matched_title = title.clone();
                    if let Some(id) = id {
                        if let Ok(review_response) = client.get(format!("https://api.jikan.moe/v4/manga/{id}/reviews")).query(&[("preliminary", "true"), ("spoilers", "false")]).send().await {
                            if review_response.status().is_success() {
                                if let Ok(reviews) = review_response.json::<serde_json::Value>().await {
                                    if let Some(review) = reviews.get("data").and_then(|v| v.as_array()).and_then(|a| a.first()).and_then(|v| v.get("review")).and_then(|v| v.as_str()) { body = review.to_string(); }
                                }
                            }
                        }
                    }
                    bundle.cards.push(ReviewCard { provider: "MyAnimeList".into(), title, score, body: short_review(&body), url });
                }
            }
        },
        Ok(response) => bundle.warnings.push(format!("MyAnimeList lookup returned HTTP {}", response.status())),
        Err(e) => bundle.warnings.push(format!("MyAnimeList lookup unavailable: {e}")),
    }

    // ComicK tracker lookup. Its public endpoint can change, so failure is non-fatal.
    match client.get("https://api.comick.dev/v1.0/search").query(&[("q", query.as_str()), ("limit", "20"), ("page", "1"), ("t", "false")]).send().await {
        Ok(response) if response.status().is_success() => {
            if let Ok(value) = response.json::<serde_json::Value>().await {
                let item = value.as_array().and_then(|a| a.first())
                    .or_else(|| value.get("results").and_then(|v| v.as_array()).and_then(|a| a.first()));
                if let Some(item) = item.filter(|item| title_matches_query(&query, item)) {
                    if title_matches_query(&query, item) {
                        let country = item.get("country").or_else(|| item.get("country_code")).or_else(|| item.get("origination")).and_then(|v| v.as_str());
                        if let Some(medium) = country.and_then(medium_from_country) {
                            bundle.suggested_medium = Some(medium);
                            bundle.classification_source = "ComicK origination".into();
                        }
                    }
                    let title = item.get("title").and_then(|v| v.as_str()).unwrap_or(&query).to_string();
                    let score = item.get("score").or_else(|| item.get("rating")).or_else(|| item.get("average_rating")).and_then(|v| v.as_f64());
                    let body = item.get("desc").or_else(|| item.get("description")).and_then(|v| v.as_str()).unwrap_or("");
                    let slug = item.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                    let url = if slug.is_empty() { "https://comick.io".into() } else { format!("https://comick.io/comic/{slug}") };
                    bundle.cards.push(ReviewCard { provider: "ComicK tracker".into(), title, score, body: short_review(body), url });
                }
            }
        },
        Ok(response) => bundle.warnings.push(format!("ComicK lookup returned HTTP {}", response.status())),
        Err(e) => bundle.warnings.push(format!("ComicK lookup unavailable: {e}")),
    }

    // Publishers rarely expose a common review API. Preserve the official blurb/link carried by the file.
    if !metadata.publisher.trim().is_empty() || !metadata.description.trim().is_empty() || !metadata.source_url.trim().is_empty() {
        let url = if metadata.source_url.starts_with("https://") || metadata.source_url.starts_with("http://") { metadata.source_url.clone() } else { String::new() };
        bundle.cards.push(ReviewCard {
            provider: if metadata.publisher.trim().is_empty() { "Original publisher".into() } else { metadata.publisher.clone() },
            title: if metadata.title_hint.trim().is_empty() { query.clone() } else { metadata.title_hint.clone() },
            score: None,
            body: short_review(if metadata.description.trim().is_empty() { "No official publisher blurb was embedded in this file." } else { &metadata.description }),
            url,
        });
    } else {
        bundle.cards.push(ReviewCard { provider: "Original publisher".into(), title: query.clone(), score: None, body: "No publisher metadata was embedded in this file yet. You can add publisher information in Edit metadata.".into(), url: String::new() });
    }
    Ok(bundle)
}
#[tauri::command]
async fn read_shelf_cover(state: State<'_, Backend>, series: String, private: bool) -> ApiResult<tauri::ipc::Response> {
    let bytes = work(state.inner().clone(), move |s| s.read_shelf_cover(&series, private)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn set_shelf_cover(app: AppHandle, state: State<'_, Backend>, gate: State<'_, DialogGate>, series: String, private: bool) -> ApiResult<bool> {
    if private { work(state.inner().clone(), |s| s.touch_vault()).await?; }
    gate.inner().0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A file picker is already open".to_string())?;
    let guard = DialogGuard(gate.inner().0.clone());
    let app_copy = app.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || {
        app_copy.dialog().file().set_title("Choose a comic cover")
            .add_filter("Images", &["jpg", "jpeg", "png", "webp", "gif"])
            .blocking_pick_file()
    }).await.map_err(|_| "File picker was interrupted".to_string())?;
    drop(guard);
    let Some(file) = selection else { return Ok(false); };
    let path = file.into_path().map_err(|_| "Only local files are supported".to_string())?;
    work(state.inner().clone(), move |s| s.set_shelf_cover(&series, private, &path)).await?;
    Ok(true)
}

#[tauri::command]
async fn remove_shelf_cover(state: State<'_, Backend>, series: String, private: bool) -> ApiResult<bool> {
    work(state.inner().clone(), move |s| s.remove_shelf_cover(&series, private)).await
}

#[tauri::command]
async fn save_progress(state: State<'_, Backend>, id: String, progress: Progress) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.save_progress(&id, progress)).await
}
#[tauri::command]
async fn set_pdf_pages(state: State<'_, Backend>, id: String, pages: Vec<PageSize>) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.set_pdf_pages(&id, pages)).await
}
#[tauri::command]
async fn edit_book(state: State<'_, Backend>, id: String, edit: EditBook) -> ApiResult<Book> {
    work(state.inner().clone(), move |s| s.edit_book(&id, edit)).await
}
#[tauri::command]
async fn set_series_medium(state: State<'_, Backend>, series: String, medium: Medium) -> ApiResult<usize> {
    work(state.inner().clone(), move |s| s.set_series_medium(&series, medium)).await
}
#[tauri::command]
async fn remove_book(state: State<'_, Backend>, id: String) -> ApiResult<Option<String>> {
    work(state.inner().clone(), move |s| s.remove_book(&id)).await
}
#[tauri::command]
async fn transfer_book(state: State<'_, Backend>, id: String, private: bool) -> ApiResult<TransferResult> {
    work(state.inner().clone(), move |s| s.transfer_book(&id, private)).await
}
#[tauri::command]
async fn vault_status(state: State<'_, Backend>) -> ApiResult<VaultStatus> {
    work(state.inner().clone(), |s| s.vault_status()).await
}
#[tauri::command]
async fn create_vault(state: State<'_, Backend>, passphrase: String) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.create_vault(passphrase)).await
}
#[tauri::command]
async fn unlock_vault(state: State<'_, Backend>, passphrase: String) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.unlock_vault(passphrase)).await
}
#[tauri::command]
async fn touch_vault(state: State<'_, Backend>) -> ApiResult<()> {
    work(state.inner().clone(), |s| s.touch_vault()).await
}
#[tauri::command]
async fn export_vault_backup(app: AppHandle, state: State<'_, Backend>, gate: State<'_, DialogGate>) -> ApiResult<Option<String>> {
    gate.inner().0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A file picker is already open".to_string())?;
    let guard = DialogGuard(gate.inner().0.clone());
    let app_copy = app.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || {
        app_copy.dialog().file().set_title("Choose where to save the encrypted private-library backup").blocking_pick_folder()
    }).await.map_err(|_| "Folder picker was interrupted".to_string())?;
    drop(guard);
    let Some(folder) = selection else { return Ok(None); };
    let path = folder.into_path().map_err(|_| "Only local folders are supported".to_string())?;
    let saved = work(state.inner().clone(), move |s| s.export_vault_backup(&path)).await?;
    Ok(Some(saved.to_string_lossy().to_string()))
}
#[tauri::command]
async fn reset_vault(app: AppHandle, state: State<'_, Backend>) -> ApiResult<VaultResetResult> {
    let result = work(state.inner().clone(), |s| s.reset_vault()).await?;
    let _ = app.emit("vault-locked", ());
    Ok(result)
}
#[tauri::command]
async fn lock_vault(app: AppHandle, state: State<'_, Backend>) -> ApiResult<()> {
    work(state.inner().clone(), |s| { s.lock_vault(); Ok(()) }).await?;
    let _ = app.emit("vault-locked", ()); Ok(())
}
#[tauri::command]
async fn quit_app(app: AppHandle, state: State<'_, Backend>) -> ApiResult<()> {
    work(state.inner().clone(), |s| { s.lock_vault(); Ok(()) }).await?;
    app.exit(0); Ok(())
}


#[tauri::command]
async fn import_novels(app: AppHandle, state: State<'_, Backend>, gate: State<'_, DialogGate>, private: bool) -> ApiResult<ImportReport> {
    if private { work(state.inner().clone(), |s| s.touch_vault()).await?; }
    gate.inner().0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A file picker is already open".to_string())?;
    let guard = DialogGuard(gate.inner().0.clone());
    let app_copy = app.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || {
        app_copy.dialog().file().set_title("Import novels - originals will not be changed")
            .add_filter("Novels and documents", &["epub", "pdf", "docx", "txt"])
            .blocking_pick_files().unwrap_or_default()
    }).await.map_err(|_| "File picker was interrupted".to_string())?;
    drop(guard);
    let paths = selection.into_iter().map(|p| p.into_path().map_err(|_| "Only local files are supported".to_string()))
        .collect::<ApiResult<Vec<_>>>()?;
    work(state.inner().clone(), move |s| s.import_novel_paths(paths, private)).await
}
#[tauri::command]
async fn import_books(app: AppHandle, state: State<'_, Backend>, gate: State<'_, DialogGate>, folder: bool, private: bool) -> ApiResult<ImportReport> {
    if private {
        work(state.inner().clone(), |s| s.touch_vault()).await?;
    }
    gate.inner().0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A file picker is already open".to_string())?;
    let guard = DialogGuard(gate.inner().0.clone());
    let app_copy = app.clone();
    // Blocking native dialogs must not run on the GUI event-loop thread.
    let selection = tauri::async_runtime::spawn_blocking(move || {
        if folder {
            app_copy.dialog().file().set_title("Import a comic image folder").blocking_pick_folder().into_iter().collect::<Vec<_>>()
        } else {
            app_copy.dialog().file().set_title("Import comics - originals will not be changed")
                .add_filter("Comics and documents", &["cbz", "zip", "pdf", "epub", "docx", "doc", "txt", "jpg", "jpeg", "png", "webp", "gif"])
                .blocking_pick_files().unwrap_or_default()
        }
    }).await.map_err(|_| "File picker was interrupted".to_string())?;
    drop(guard);
    let paths = selection.into_iter().map(|p| p.into_path().map_err(|_| "Only local files are supported".to_string()))
        .collect::<ApiResult<Vec<_>>>()?;
    work(state.inner().clone(), move |s| s.import_paths(paths, private)).await
}

#[tauri::command]
async fn list_watched_folders(state: State<'_, Backend>) -> ApiResult<Vec<WatchedFolder>> {
    work(state.inner().clone(), |s| s.list_watched_folders()).await
}

#[tauri::command]
async fn watch_comic_folder(app: AppHandle, state: State<'_, Backend>, gate: State<'_, DialogGate>) -> ApiResult<WatchSyncResult> {
    gate.inner().0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A file picker is already open".to_string())?;
    let guard = DialogGuard(gate.inner().0.clone());
    let app_copy = app.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || {
        app_copy.dialog().file().set_title("Choose your normal library folder").blocking_pick_folder()
    }).await.map_err(|_| "File picker was interrupted".to_string())?;
    drop(guard);
    let Some(folder) = selection else { return Ok(WatchSyncResult::default()); };
    let path = folder.into_path().map_err(|_| "Only local folders are supported".to_string())?;
    let result = work(state.inner().clone(), move |s| { s.add_watched_folder(path)?; s.sync_watched_folders() }).await?;
    if !result.imported.is_empty() { let _ = app.emit("library-updated", ()); }
    Ok(result)
}

#[tauri::command]
async fn unwatch_comic_folder(state: State<'_, Backend>, id: String) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.remove_watched_folder(&id)).await
}

#[tauri::command]
async fn sync_watched_folders(app: AppHandle, state: State<'_, Backend>) -> ApiResult<WatchSyncResult> {
    let result = work(state.inner().clone(), |s| s.sync_watched_folders()).await?;
    if !result.imported.is_empty() { let _ = app.emit("library-updated", ()); }
    Ok(result)
}

#[tauri::command]
async fn music_snapshot(state: State<'_, Backend>) -> ApiResult<MusicSnapshot> {
    work(state.inner().clone(), |s| s.music_snapshot()).await
}

#[tauri::command]
async fn import_music(app: AppHandle, state: State<'_, Backend>, gate: State<'_, DialogGate>) -> ApiResult<Vec<MusicTrack>> {
    gate.inner().0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A file picker is already open".to_string())?;
    let guard = DialogGuard(gate.inner().0.clone());
    let app_copy = app.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || {
        app_copy.dialog().file().set_title("Import MP3 files - Ippo will keep its own copy")
            .add_filter("MP3 audio", &["mp3"]).blocking_pick_files().unwrap_or_default()
    }).await.map_err(|_| "File picker was interrupted".to_string())?;
    drop(guard);
    let paths = selection.into_iter().map(|p| p.into_path().map_err(|_| "Only local files are supported".to_string()))
        .collect::<ApiResult<Vec<_>>>()?;
    work(state.inner().clone(), move |s| s.import_music_paths(paths)).await
}

#[tauri::command]
async fn read_music_track(state: State<'_, Backend>, id: String) -> ApiResult<tauri::ipc::Response> {
    let bytes = work(state.inner().clone(), move |s| s.read_music_track(&id)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn create_music_playlist(state: State<'_, Backend>, name: String) -> ApiResult<MusicPlaylist> {
    work(state.inner().clone(), move |s| s.create_music_playlist(name)).await
}
#[tauri::command]
async fn delete_music_playlist(state: State<'_, Backend>, id: String) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.delete_music_playlist(&id)).await
}
#[tauri::command]
async fn set_music_playlist_tracks(state: State<'_, Backend>, id: String, track_ids: Vec<String>) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.set_music_playlist_tracks(&id, track_ids)).await
}
#[tauri::command]
async fn delete_music_track(state: State<'_, Backend>, id: String) -> ApiResult<()> {
    work(state.inner().clone(), move |s| s.delete_music_track(&id)).await
}

pub fn run() {
    tauri::Builder::default()
        // Prevent simultaneous processes from racing library writes/staging cleanup.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.set_focus(); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let backend = Backend(Arc::new(Mutex::new(Store::open(root)?)));
            let gate = DialogGate(Arc::new(AtomicBool::new(false)));
            app.manage(backend.clone()); app.manage(gate.clone());
            let handle = app.handle().clone();
            let vault_backend = backend.clone();
            let vault_gate = gate.clone();
            // A brief focus transition (for example, closing the unlock dialog) must not instantly lock
            // the vault. Private DOM is concealed immediately by the frontend; the native key is dropped
            // after two continuous seconds out of focus, or after the normal five-minute idle timeout.
            std::thread::spawn(move || {
                let mut unfocused_since: Option<std::time::Instant> = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let dialog_open = vault_gate.0.load(Ordering::SeqCst);
                    let focused = handle.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(true);
                    if dialog_open || focused { unfocused_since = None; }
                    else if unfocused_since.is_none() { unfocused_since = Some(std::time::Instant::now()); }
                    if let Ok(mut store) = vault_backend.0.lock() {
                        let focus_lock = unfocused_since.is_some_and(|t| t.elapsed() >= std::time::Duration::from_secs(2));
                        let locked = if focus_lock { store.lock_vault() } else { store.expire_vault() };
                        if locked { let _ = handle.emit("vault-locked", ()); unfocused_since = None; }
                    }
                }
            });

            let watch_handle = app.handle().clone();
            let watch_backend = backend.clone();
            // Normal-library watched folders are polled locally. New/changed chapter files are copied
            // into managed storage; private-library imports are intentionally never watched.
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                if let Ok(mut store) = watch_backend.0.lock() {
                    if let Ok(result) = store.sync_watched_folders() {
                        if !result.imported.is_empty() { let _ = watch_handle.emit("library-updated", ()); }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            classification::classification_books, classification::classification_sources, classification::apply_classification, classification::reread_comic_metadata,
            list_books, read_page, read_cover, read_novel, add_reading_time, series_reviews, read_shelf_cover, set_shelf_cover, remove_shelf_cover, save_progress, set_pdf_pages, import_books, import_novels,
            edit_book, set_series_medium, remove_book, transfer_book, vault_status, create_vault, unlock_vault,
            lock_vault, touch_vault, export_vault_backup, reset_vault, quit_app, music_snapshot, import_music, read_music_track, create_music_playlist,
            delete_music_playlist, set_music_playlist_tracks, delete_music_track, list_watched_folders, watch_comic_folder,
            unwatch_comic_folder, sync_watched_folders
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Ippo to Read");
}
