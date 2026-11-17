use crate::{crypto, importer::{self, MAX_FILE_BYTES, MAX_PAGE_BYTES}, model::*, naming};
use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::{collections::HashSet, fs::{self, File}, io::Cursor, path::{Path, PathBuf}, time::{Duration, Instant}};
use uuid::Uuid;
use zeroize::Zeroizing;
use image::{codecs::jpeg::JpegEncoder, ImageReader};

const VERIFIER: &[u8] = b"Ippo to Read private library v1";
const VERIFIER_CONTEXT: &[u8] = b"ippo/v1/vault-verifier";
const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_MUSIC_BYTES: u64 = 150 * 1024 * 1024;

struct Session { key: Zeroizing<[u8; 32]>, last_activity: Instant }

/// A Store is used behind a mutex by the desktop shell. All mutations are serialized.
/// Private records contain encrypted metadata; no private title/path is a SQL column.
pub struct Store {
    root: PathBuf,
    db: Connection,
    session: Option<Session>,
    failed_unlocks: u32,
    retry_after: Option<Instant>,
}

impl Store {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        importer::secure_dir(&root)?;
        importer::secure_dir(&root.join("books"))?;
        importer::secure_dir(&root.join("staging"))?;
        importer::secure_dir(&root.join("music"))?;
        // The desktop is single-instance. Interrupted imports are safe to discard:
        // private staging resources were encrypted BEFORE being written.
        for entry in fs::read_dir(root.join("staging"))? {
            let p = entry?.path();
            if p.is_dir() { fs::remove_dir_all(p)?; } else { fs::remove_file(p)?; }
        }
        let db_path = root.join("library.sqlite");
        let db = Connection::open(&db_path)?;
        db.busy_timeout(Duration::from_secs(10))?;
        let schema: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        ensure!(schema <= 5, "This library was created by a newer version of Ippo to Read");
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY NOT NULL,
                private INTEGER NOT NULL CHECK(private IN (0,1)),
                payload BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS books_privacy ON books(private);
            CREATE TABLE IF NOT EXISTS vault (
                version INTEGER PRIMARY KEY CHECK(version=1),
                salt BLOB NOT NULL,
                verifier BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS shelf_covers (
                id TEXT PRIMARY KEY NOT NULL,
                private INTEGER NOT NULL CHECK(private IN (0,1)),
                key_payload BLOB NOT NULL,
                image_payload BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS shelf_covers_privacy ON shelf_covers(private);
            CREATE TABLE IF NOT EXISTS music_tracks (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                added_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS music_playlists (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS music_playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY(playlist_id, track_id),
                FOREIGN KEY(playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE,
                FOREIGN KEY(track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS watched_folders (
                id TEXT PRIMARY KEY NOT NULL,
                path TEXT NOT NULL UNIQUE,
                added_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS watched_files (
                path TEXT PRIMARY KEY NOT NULL,
                watch_id TEXT NOT NULL,
                book_id TEXT NOT NULL,
                size INTEGER NOT NULL,
                modified_ms INTEGER NOT NULL,
                FOREIGN KEY(watch_id) REFERENCES watched_folders(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS watched_files_watch ON watched_files(watch_id);
            PRAGMA foreign_keys=ON;
            PRAGMA user_version=5;")?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(db_path, fs::Permissions::from_mode(0o600))?;
        }
        Ok(Self { root, db, session: None, failed_unlocks: 0, retry_after: None })
    }

    pub fn expire_vault(&mut self) -> bool {
        if self.session.as_ref().is_some_and(|s| s.last_activity.elapsed() >= IDLE_TIMEOUT) {
            return self.lock_vault();
        }
        false
    }

    pub fn lock_vault(&mut self) -> bool { self.session.take().is_some() }

    fn key(&mut self) -> Result<&[u8; 32]> {
        self.expire_vault();
        self.session.as_ref().map(|s| &*s.key).context("Private library is locked")
    }

    pub fn touch_vault(&mut self) -> Result<()> {
        self.key()?;
        if let Some(session) = &mut self.session { session.last_activity = Instant::now(); }
        Ok(())
    }

    pub fn vault_status(&mut self) -> Result<VaultStatus> {
        self.expire_vault();
        let configured = self.db.query_row("SELECT EXISTS(SELECT 1 FROM vault)", [], |r| r.get(0))?;
        Ok(VaultStatus { configured, unlocked: self.session.is_some() })
    }

    pub fn create_vault(&mut self, passphrase: String) -> Result<()> {
        let passphrase = Zeroizing::new(passphrase);
        ensure!(!self.vault_status()?.configured, "Private library already exists");
        ensure!(passphrase.chars().count() >= 12, "Use a passphrase with at least 12 characters");
        let salt = crypto::random_salt();
        let key = crypto::derive_key(&passphrase, &salt)?;
        let verifier = crypto::seal(&key, VERIFIER, VERIFIER_CONTEXT)?;
        self.db.execute("INSERT INTO vault(version,salt,verifier) VALUES(1,?1,?2)", params![salt.as_slice(), verifier])?;
        self.session = Some(Session { key, last_activity: Instant::now() });
        Ok(())
    }

    pub fn unlock_vault(&mut self, passphrase: String) -> Result<()> {
        let passphrase = Zeroizing::new(passphrase);
        if let Some(retry) = self.retry_after {
            if retry > Instant::now() { bail!("Please wait {} seconds before trying again", (retry - Instant::now()).as_secs() + 1); }
        }
        let (salt, verifier): (Vec<u8>, Vec<u8>) = self.db.query_row(
            "SELECT salt,verifier FROM vault WHERE version=1", [], |r| Ok((r.get(0)?, r.get(1)?))
        ).optional()?.context("Create a private library first")?;
        let key = crypto::derive_key(&passphrase, &salt)?;
        let verified = crypto::open(&key, &verifier, VERIFIER_CONTEXT)
            .map(|data| data.as_slice() == VERIFIER).unwrap_or(false);
        if !verified {
            self.failed_unlocks = self.failed_unlocks.saturating_add(1);
            self.retry_after = Some(Instant::now() + Duration::from_secs((1u64 << self.failed_unlocks.min(5)).min(30)));
            bail!("Unable to unlock: incorrect passphrase or damaged private library");
        }
        self.session = Some(Session { key, last_activity: Instant::now() });
        self.failed_unlocks = 0; self.retry_after = None;
        Ok(())
    }


    fn normal_storage_ids(&mut self) -> Result<HashSet<String>> {
        let rows: Vec<Vec<u8>> = {
            let mut statement = self.db.prepare("SELECT payload FROM books WHERE private=0")?;
            let mapped = statement.query_map([], |r| r.get(0))?;
            mapped.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut keep = HashSet::new();
        for payload in rows {
            if let Ok(record) = serde_json::from_slice::<StoredBook>(&payload) {
                keep.insert(record.storage_id);
            }
        }
        Ok(keep)
    }

    fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<()> {
        importer::secure_dir(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let src = entry.path();
            let dst = destination.join(entry.file_name());
            let ty = entry.file_type()?;
            if ty.is_dir() { Self::copy_dir_recursive(&src, &dst)?; }
            else if ty.is_file() { fs::copy(&src, &dst)?; }
        }
        Ok(())
    }

    /// Saves an encrypted, locked snapshot without needing the passphrase.
    /// The snapshot intentionally contains encrypted blobs only; it is not a decryption bypass.
    pub fn export_vault_backup(&mut self, destination_root: &Path) -> Result<PathBuf> {
        ensure!(self.vault_status()?.configured, "Private library is not configured");
        ensure!(destination_root.is_dir(), "Choose an existing folder for the backup");
        let backup = destination_root.join(format!("Ippo Private Backup {}", now_ms()));
        importer::secure_dir(&backup)?;
        importer::secure_dir(&backup.join("vault"))?;
        importer::secure_dir(&backup.join("records").join("books"))?;
        importer::secure_dir(&backup.join("records").join("shelf-covers"))?;
        importer::secure_dir(&backup.join("storage"))?;

        let (salt, verifier): (Vec<u8>, Vec<u8>) = self.db.query_row(
            "SELECT salt,verifier FROM vault WHERE version=1", [], |r| Ok((r.get(0)?, r.get(1)?))
        )?;
        fs::write(backup.join("vault").join("salt.bin"), salt)?;
        fs::write(backup.join("vault").join("verifier.bin"), verifier)?;

        let private_books: Vec<(String, Vec<u8>)> = {
            let mut q = self.db.prepare("SELECT id,payload FROM books WHERE private=1 ORDER BY id")?;
            let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        for (id, payload) in &private_books {
            fs::write(backup.join("records").join("books").join(format!("{id}.bin")), payload)?;
        }

        let private_covers: Vec<(String, Vec<u8>, Vec<u8>)> = {
            let mut q = self.db.prepare("SELECT id,key_payload,image_payload FROM shelf_covers WHERE private=1 ORDER BY id")?;
            let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        for (id, key, image) in &private_covers {
            let folder = backup.join("records").join("shelf-covers").join(id);
            importer::secure_dir(&folder)?;
            fs::write(folder.join("key.bin"), key)?;
            fs::write(folder.join("image.bin"), image)?;
        }

        let normal = self.normal_storage_ids()?;
        let books_root = self.root.join("books");
        if books_root.is_dir() {
            for entry in fs::read_dir(&books_root)? {
                let entry = entry?;
                if !entry.file_type()?.is_dir() { continue; }
                let name = entry.file_name().to_string_lossy().to_string();
                if !normal.contains(&name) {
                    Self::copy_dir_recursive(&entry.path(), &backup.join("storage").join(&name))?;
                }
            }
        }
        fs::write(backup.join("README.txt"), format!(
            "Ippo to Read encrypted private-library backup\nCreated: {}\nPrivate records: {}\n\nThis backup is still encrypted with the OLD passphrase. It does not bypass encryption. Keep the whole folder together. A compatible restore tool plus the old passphrase is required to decrypt it.\n",
            now_ms(), private_books.len()
        ))?;
        Ok(backup)
    }

    /// Destructively removes the managed private library without decrypting it.
    /// Encrypted files are deleted on a best-effort basis; physical secure erasure is not guaranteed.
    pub fn reset_vault(&mut self) -> Result<VaultResetResult> {
        ensure!(self.vault_status()?.configured, "Private library is not configured");
        self.lock_vault();
        let private_ids: Vec<String> = {
            let mut q = self.db.prepare("SELECT id FROM books WHERE private=1 ORDER BY id")?;
            let rows = q.query_map([], |r| r.get(0))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut warnings = Vec::new();
        // Direct private imports use their book ID as the storage folder, so these can be
        // removed safely without the key. Older comics transferred into the vault may use
        // a different encrypted storage ID; those are intentionally not guessed at because
        // guessing could delete a damaged normal-library folder.
        for id in &private_ids {
            let path = self.root.join("books").join(id);
            match fs::remove_dir_all(&path) {
                Ok(()) => {},
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
                Err(error) => warnings.push(format!("Could not remove one encrypted managed folder ({id}): {error}")),
            }
        }
        let tx = self.db.transaction()?;
        tx.execute("DELETE FROM books WHERE private=1", [])?;
        tx.execute("DELETE FROM shelf_covers WHERE private=1", [])?;
        tx.execute("DELETE FROM vault", [])?;
        tx.commit()?;
        self.db.execute_batch("PRAGMA secure_delete=ON; VACUUM;")?;
        self.failed_unlocks = 0;
        self.retry_after = None;
        if !private_ids.is_empty() {
            warnings.push("Older comics that were moved into the private library may leave encrypted orphan storage behind. Ippo does not guess those folder IDs while locked because that could risk deleting normal-library data.".into());
        }
        Ok(VaultResetResult { warnings })
    }

    fn validate_record(record: &StoredBook) -> Result<()> {
        Uuid::parse_str(&record.book.id).context("Invalid book ID")?;
        Uuid::parse_str(&record.storage_id).context("Invalid storage ID")?;
        for name in &record.resources {
            let page_number = name.strip_prefix("page-").and_then(|x| x.strip_suffix(".bin"));
            let allowed = name == "cover.bin" || name == "document.bin" || name == "novel.bin" ||
                page_number.is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()));
            ensure!(allowed, "Invalid stored resource name");
        }
        Ok(())
    }

    fn decode(&mut self, id: &str, private: bool, payload: Vec<u8>) -> Result<StoredBook> {
        let bytes = if private { crypto::open(self.key()?, &payload, &importer::context(id, "metadata"))? }
            else { Zeroizing::new(payload) };
        let record: StoredBook = serde_json::from_slice(&bytes).context("Library metadata is damaged")?;
        ensure!(record.book.id == id && record.book.is_private == private, "Library record identity mismatch");
        Self::validate_record(&record)?;
        Ok(record)
    }

    fn get(&mut self, id: &str) -> Result<StoredBook> {
        Uuid::parse_str(id).context("Invalid book ID")?;
        let (private, payload): (bool, Vec<u8>) = self.db.query_row(
            "SELECT private,payload FROM books WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?))
        ).optional()?.context("Comic not found")?;
        self.decode(id, private, payload)
    }

    fn put(&mut self, record: &StoredBook) -> Result<()> {
        Self::validate_record(record)?;
        let plain = Zeroizing::new(serde_json::to_vec(record)?);
        let payload = if record.book.is_private {
            crypto::seal(self.key()?, &plain, &importer::context(&record.book.id, "metadata"))?
        } else { plain.to_vec() };
        self.db.execute("INSERT INTO books(id,private,payload) VALUES(?1,?2,?3)
            ON CONFLICT(id) DO UPDATE SET private=excluded.private,payload=excluded.payload",
            params![record.book.id, record.book.is_private, payload])?;
        Ok(())
    }


    fn normalized_shelf_key(series: &str) -> String {
        series.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
    }

    fn shelf_context(id: &str, field: &str) -> Vec<u8> {
        format!("ippo/v1/shelf/{id}/{field}").into_bytes()
    }

    fn find_shelf_cover(&mut self, series: &str, private: bool) -> Result<Option<(String, Vec<u8>)>> {
        if private { self.key()?; }
        let wanted = Self::normalized_shelf_key(series);
        let rows: Vec<(String, Vec<u8>, Vec<u8>)> = {
            let mut statement = self.db.prepare("SELECT id,key_payload,image_payload FROM shelf_covers WHERE private=?1 ORDER BY id")?;
            let rows = statement.query_map([private], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (id, key_payload, image_payload) in rows {
            let key_bytes = if private {
                crypto::open(self.key()?, &key_payload, &Self::shelf_context(&id, "key"))?
            } else { Zeroizing::new(key_payload) };
            if key_bytes.as_slice() == wanted.as_bytes() {
                let image = if private {
                    crypto::open(self.key()?, &image_payload, &Self::shelf_context(&id, "image"))?.to_vec()
                } else { image_payload };
                return Ok(Some((id, image)));
            }
        }
        Ok(None)
    }

    pub fn read_shelf_cover(&mut self, series: &str, private: bool) -> Result<Vec<u8>> {
        self.find_shelf_cover(series, private)?.map(|(_, bytes)| bytes)
            .context("This shelf does not have a custom image")
    }

    pub fn set_shelf_cover(&mut self, series: &str, private: bool, path: &Path) -> Result<()> {
        let series = series.split_whitespace().collect::<Vec<_>>().join(" ");
        ensure!(!series.is_empty() && series.len() <= 512, "Invalid shelf name");
        if private { self.touch_vault()?; }
        ensure!(!fs::symlink_metadata(path)?.file_type().is_symlink(), "Select the original image, not a symbolic link");
        let bytes = importer::read_limited(File::open(path)?, MAX_PAGE_BYTES)?;
        let reader = ImageReader::new(Cursor::new(bytes.as_slice())).with_guessed_format()?;
        let (width, height) = reader.into_dimensions()?;
        ensure!(width > 0 && height > 0 && u64::from(width) * u64::from(height) <= 40_000_000, "Shelf image dimensions exceed 40 megapixels");
        let image = image::load_from_memory(bytes.as_slice()).context("Unsupported shelf image")?;
        let small = image.thumbnail(900, 1400).to_rgb8();
        let mut encoded = Zeroizing::new(Vec::new());
        JpegEncoder::new_with_quality(&mut *encoded, 88).encode_image(&image::DynamicImage::ImageRgb8(small))?;

        if let Some((old_id, _)) = self.find_shelf_cover(&series, private)? {
            self.db.execute("DELETE FROM shelf_covers WHERE id=?1", [old_id])?;
        }
        let id = Uuid::new_v4().to_string();
        let normalized = Self::normalized_shelf_key(&series);
        let (key_payload, image_payload) = if private {
            let key = Zeroizing::new(*self.key()?);
            (
                crypto::seal(&key, normalized.as_bytes(), &Self::shelf_context(&id, "key"))?,
                crypto::seal(&key, &encoded, &Self::shelf_context(&id, "image"))?,
            )
        } else { (normalized.into_bytes(), encoded.to_vec()) };
        self.db.execute("INSERT INTO shelf_covers(id,private,key_payload,image_payload) VALUES(?1,?2,?3,?4)",
            params![id, private, key_payload, image_payload])?;
        Ok(())
    }

    pub fn remove_shelf_cover(&mut self, series: &str, private: bool) -> Result<bool> {
        if private { self.touch_vault()?; }
        let Some((id, _)) = self.find_shelf_cover(series, private)? else { return Ok(false); };
        Ok(self.db.execute("DELETE FROM shelf_covers WHERE id=?1", [id])? > 0)
    }

    pub fn list_books(&mut self, private: bool) -> Result<Vec<Book>> {
        if private { self.key()?; }
        let rows: Vec<(String, Vec<u8>)> = {
            let mut statement = self.db.prepare("SELECT id,payload FROM books WHERE private=?1 ORDER BY id")?;
            let rows = statement.query_map([private], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        rows.into_iter().map(|(id, payload)| self.decode(&id, private, payload).map(|x| x.book)).collect()
    }

    pub fn import_one(&mut self, path: &Path, private: bool) -> Result<Book> {
        let key = if private { Some(Zeroizing::new(*self.key()?)) } else { None };
        let id = Uuid::new_v4().to_string();
        let stage = self.root.join("staging").join(&id);
        let destination = self.root.join("books").join(&id);
        importer::secure_dir(&stage)?;
        let result = (|| -> Result<Book> {
            let content = importer::import_content(path, &stage, &id, key.as_ref().map(|x| &**x))?;
            let stem = if path.is_dir() { path.file_name() } else { path.file_stem() }
                .and_then(|s| s.to_str()).unwrap_or("Untitled");
            let name = naming::parse_name(stem);
            let mut metadata = content.metadata;
            metadata.source_filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let embedded_title = metadata.title_hint.trim();
            let embedded_series = metadata.series_hint.trim();
            let series = if !embedded_series.is_empty() { embedded_series.to_string() }
                else if content.kind == BookKind::Novel && !embedded_title.is_empty() { embedded_title.to_string() }
                else { name.series.clone() };
            let title = if !embedded_title.is_empty() { embedded_title.to_string() } else { name.title.clone() };
            let volume = metadata.volume_hint.or(name.volume);
            let chapter = metadata.chapter_hint.or(name.chapter);
            // A confirmed shelf choice applies to future chapters as well. Privacy scopes
            // are deliberately separate, and conflicting saved choices are never inherited.
            let peers = self.list_books(private)?;
            let decisions: Vec<_> = peers.iter().filter(|b| b.kind != BookKind::Novel && content.kind != BookKind::Novel &&
                Self::normalized_identity_text(&b.series) == Self::normalized_identity_text(&series))
                .filter_map(|b| b.metadata.classification.as_ref())
                .filter(|d| d.locked || d.status == "confirmed").collect();
            let selected = decisions.iter().find(|d| d.locked).or_else(|| decisions.first());
            if let Some(chosen) = selected {
                if decisions.iter().all(|d| d.medium == chosen.medium && d.layout == chosen.layout) {
                    metadata.medium = chosen.medium;
                    metadata.classification = Some((**chosen).clone());
                }
            }
            let book = Book {
                id: id.clone(), title, series, volume, chapter,
                kind: content.kind,
                format: if path.is_dir() { "FOLDER".into() } else { path.extension().and_then(|x| x.to_str()).unwrap_or("").to_uppercase() },
                pages: content.pages, has_cover: content.has_cover, progress: Progress::default(),
                last_read: 0, added_at: now_ms(), is_private: private,
                metadata, reading_seconds: 0, word_count: content.word_count,
            };
            let record = StoredBook { book: book.clone(), storage_id: id.clone(), resources: content.resources };
            fs::rename(&stage, &destination)?;
            self.put(&record)?;
            Ok(book)
        })();
        if result.is_err() { let _ = fs::remove_dir_all(&stage); let _ = fs::remove_dir_all(&destination); }
        result
    }

    pub fn import_paths(&mut self, paths: Vec<PathBuf>, private: bool) -> Result<ImportReport> {
        ensure!(paths.len() <= 200, "Import at most 200 files at once");
        if private { self.touch_vault()?; }
        let mut report = ImportReport::default();
        for path in paths {
            let docx = path.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("docx"));
            match self.import_one(&path, private) {
                Ok(book) => {
                    report.imported.push(book);
                    if docx && report.warnings.is_empty() {
                        report.warnings.push("DOCX files with substantial text open in Novel mode. Image-heavy DOCX files fall back to comic images; exact Word page layout, headers and vector art are not reproduced.".into());
                    }
                }
                Err(e) => report.errors.push(format!("{}: {e:#}", path.file_name().unwrap_or_default().to_string_lossy())),
            }
        }
        Ok(report)
    }

    /// Novel-picker imports must actually land in the novel library. Older builds could
    /// accept an EPUB whose text extraction failed, fall back to image/comic mode, and
    /// still tell the UI that a novel was imported. Reject that mismatch instead of
    /// creating an invisible item in the Comics space.
    pub fn import_novel_paths(&mut self, paths: Vec<PathBuf>, private: bool) -> Result<ImportReport> {
        ensure!(paths.len() <= 200, "Import at most 200 files at once");
        if private { self.touch_vault()?; }
        let mut report = ImportReport::default();
        for path in paths {
            let label = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            match self.import_one(&path, private) {
                Ok(book) if book.kind == BookKind::Novel => report.imported.push(book),
                Ok(book) if book.kind == BookKind::Pdf => {
                    // PDFs are valid fixed-layout novels. Keep the PDF renderer, but classify
                    // the item into the Novels bookshelf when it was imported from Novel mode.
                    let mut record = self.get(&book.id)?;
                    record.book.metadata.medium = Medium::Novel;
                    record.book.metadata.metadata_source = "PDF fixed-layout novel".into();
                    self.put(&record)?;
                    report.imported.push(record.book);
                }
                Ok(book) => {
                    let cleanup = self.remove_book(&book.id).ok().flatten();
                    report.errors.push(format!("{label}: Ippo could not extract readable novel text from this file, so it was not added to the bookshelf.{}",
                        cleanup.map(|w| format!(" Cleanup warning: {w}")).unwrap_or_default()));
                }
                Err(e) => report.errors.push(format!("{label}: {e:#}")),
            }
        }
        Ok(report)
    }

    fn resource(&mut self, record: &StoredBook, name: &str) -> Result<Zeroizing<Vec<u8>>> {
        ensure!(record.resources.iter().any(|n| n == name), "Comic resource not found");
        let limit = if name == "document.bin" { MAX_FILE_BYTES } else { MAX_PAGE_BYTES };
        let path = self.root.join("books").join(&record.storage_id).join(name);
        let bytes = importer::read_limited(File::open(path).context("Managed comic data is missing; reimport the original")?, limit + 64)?;
        if record.book.is_private { crypto::open(self.key()?, &bytes, &importer::context(&record.book.id, name)) }
        else { Ok(bytes) }
    }

    pub fn read_page(&mut self, id: &str, index: usize) -> Result<Vec<u8>> {
        let record = self.get(id)?;
        let name = match record.book.kind {
            BookKind::Pdf => { ensure!(index == 0, "PDF must be requested as a whole document"); "document.bin".into() }
            BookKind::Images => { ensure!(index < record.book.pages.len(), "Page is out of range"); format!("page-{index:05}.bin") }
            BookKind::Novel => bail!("Novel text must be requested through the novel reader"),
        };
        Ok(self.resource(&record, &name)?.to_vec())
    }

    pub fn read_novel(&mut self, id: &str) -> Result<NovelDocument> {
        let record = self.get(id)?;
        ensure!(record.book.kind == BookKind::Novel, "This item is not a novel");
        let bytes = self.resource(&record, "novel.bin")?;
        serde_json::from_slice(&bytes).context("Managed novel text is damaged")
    }

    pub fn read_cover(&mut self, id: &str) -> Result<Vec<u8>> {
        let record = self.get(id)?;
        ensure!(record.book.has_cover, "This comic has no generated cover");
        Ok(self.resource(&record, "cover.bin")?.to_vec())
    }

    pub fn set_pdf_pages(&mut self, id: &str, mut pages: Vec<PageSize>) -> Result<()> {
        let mut record = self.get(id)?;
        ensure!(record.book.kind == BookKind::Pdf, "Comic is not a PDF");
        ensure!(!pages.is_empty(), "Unsupported PDF page count");
        for page in &mut pages {
            ensure!(page.width > 0 && page.height > 0 && page.width <= 100_000 && page.height <= 100_000, "Invalid PDF page dimensions");
            page.mime = "application/pdf".into();
        }
        record.book.progress.page = record.book.progress.page.min(pages.len() - 1);
        record.book.pages = pages;
        self.put(&record)
    }

    pub fn save_progress(&mut self, id: &str, progress: Progress) -> Result<()> {
        let mut record = self.get(id)?;
        ensure!(progress.page < record.book.pages.len(), "Cannot save a page outside this comic");
        ensure!(progress.offset.is_finite() && (0.0..=1.0).contains(&progress.offset), "Invalid reading offset");
        ensure!(progress.zoom.is_finite() && (0.6..=1.6).contains(&progress.zoom), "Invalid zoom");
        record.book.progress = progress; record.book.last_read = now_ms();
        self.put(&record)
    }

    pub fn add_reading_time(&mut self, id: &str, seconds: u64) -> Result<u64> {
        ensure!(seconds <= 300, "Reading-time update is too large");
        let mut record = self.get(id)?;
        record.book.reading_seconds = record.book.reading_seconds.saturating_add(seconds);
        self.put(&record)?;
        Ok(record.book.reading_seconds)
    }

    /// Classification works on real stored IDs, never arbitrary caller-supplied private titles.
    pub fn classification_books(&mut self, id: &str) -> Result<Vec<Book>> {
        let anchor = self.get(id)?;
        ensure!(anchor.book.kind != BookKind::Novel, "Use comic classification only for comics");
        let wanted = Self::normalized_identity_text(&anchor.book.series);
        let mut books: Vec<Book> = self.list_books(anchor.book.is_private)?.into_iter()
            .filter(|b| b.kind != BookKind::Novel && Self::normalized_identity_text(&b.series) == wanted).collect();
        // Old releases did not keep ComicInfo.xml. Re-read one available watched original,
        // without importing it or changing any chapter/book IDs, bookmarks or covers.
        if !anchor.book.is_private && books.iter().any(|b| b.metadata.metadata_revision < 2) {
            let mut source = None;
            for book in &books {
                let path: Option<String> = self.db.query_row(
                    "SELECT path FROM watched_files WHERE book_id=?1 LIMIT 1", [&book.id], |r| r.get(0)).optional()?;
                if let Some(path) = path {
                    let p = PathBuf::from(path);
                    if p.is_file() && p.extension().and_then(|s| s.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cbz") || e.eq_ignore_ascii_case("zip")) {
                        source = Some(p); break;
                    }
                }
            }
            if let Some(path) = source {
                match self.read_classification_metadata(id, &path) {
                    Ok(updated) => books = updated,
                    Err(e) => for book in &mut books { book.metadata.metadata_warnings.push(format!("Original metadata re-read failed: {e}")); },
                }
            }
        }
        Ok(books)
    }

    pub fn read_classification_metadata(&mut self, id: &str, source: &Path) -> Result<Vec<Book>> {
        let anchor = self.get(id)?;
        ensure!(anchor.book.kind != BookKind::Novel, "Select a comic shelf");
        let fresh = importer::read_comic_metadata(source)?;
        ensure!(!fresh.metadata_source.is_empty(), "{}", fresh.metadata_warnings.join("; "));
        let wanted = Self::normalized_identity_text(&anchor.book.series);
        let books = self.list_books(anchor.book.is_private)?;
        let mut updates = Vec::new();
        for book in books.into_iter().filter(|b| b.kind != BookKind::Novel && Self::normalized_identity_text(&b.series) == wanted) {
            let mut record = self.get(&book.id)?;
            let m = &mut record.book.metadata;
            // Copy series-level evidence, not this source chapter's title/number/volume.
            m.tags = fresh.tags.clone(); m.original_language = fresh.original_language.clone();
            m.country_of_origin = fresh.country_of_origin.clone(); m.publication_format = fresh.publication_format.clone();
            m.manga_indicator = fresh.manga_indicator.clone(); m.alternate_titles = fresh.alternate_titles.clone();
            if !fresh.series_hint.is_empty() { m.alternate_titles.push(fresh.series_hint.clone()); }
            m.author = fresh.author.clone(); m.publisher = fresh.publisher.clone(); m.language = fresh.language.clone();
            m.genres = fresh.genres.clone(); m.source_url = fresh.source_url.clone();
            m.metadata_source = fresh.metadata_source.clone(); m.metadata_revision = 2;
            m.metadata_warnings = fresh.metadata_warnings.clone();
            // Existing pinned choices stay pinned. The classifier can show any conflict.
            if !m.classification.as_ref().is_some_and(|d| d.locked) { m.classification = None; m.medium = fresh.medium; }
            updates.push(record);
        }
        self.put_classification_records(&updates)?;
        Ok(updates.into_iter().map(|r| r.book).collect())
    }

    fn put_classification_records(&mut self, records: &[StoredBook]) -> Result<()> {
        let mut rows = Vec::new();
        for record in records {
            Self::validate_record(record)?;
            let plain = Zeroizing::new(serde_json::to_vec(record)?);
            let payload = if record.book.is_private {
                crypto::seal(self.key()?, &plain, &importer::context(&record.book.id, "metadata"))?
            } else { plain.to_vec() };
            rows.push((record.book.id.clone(), payload));
        }
        let tx = self.db.transaction()?;
        for (id, payload) in rows { tx.execute("UPDATE books SET payload=?1 WHERE id=?2", params![payload, id])?; }
        tx.commit()?;
        Ok(())
    }

    pub fn apply_classification(&mut self, id: &str, mut decision: ClassificationDecision) -> Result<usize> {
        ensure!(decision.medium != Medium::Novel && decision.medium != Medium::Webtoon, "Choose a comic origin/type; webtoon is a separate layout");
        ensure!(["unknown", "paged", "longstrip"].contains(&decision.layout.as_str()), "Invalid layout");
        ensure!(["unknown", "suggested", "confirmed", "conflict"].contains(&decision.status.as_str()), "Invalid classification status");
        ensure!(decision.evidence.len() <= 50 && decision.aliases.len() <= 80 && decision.warnings.len() <= 50, "Classification report is too large");
        ensure!(serde_json::to_vec(&decision)?.len() <= 128 * 1024, "Classification report exceeds 128 KiB");
        decision.version = 2;
        let anchor = self.get(id)?;
        ensure!(anchor.book.kind != BookKind::Novel, "Cannot change a novel into a comic");
        let wanted = Self::normalized_identity_text(&anchor.book.series);
        let books = self.list_books(anchor.book.is_private)?;
        let mut updates = Vec::new();
        for book in books.into_iter().filter(|b| b.kind != BookKind::Novel && Self::normalized_identity_text(&b.series) == wanted) {
            if !decision.locked && book.metadata.classification.as_ref().is_some_and(|d| d.locked) { continue; }
            let mut record = self.get(&book.id)?;
            record.book.metadata.medium = decision.medium;
            record.book.metadata.classification = Some(decision.clone());
            updates.push(record);
        }
        self.put_classification_records(&updates)?;
        Ok(updates.len())
    }

    pub fn set_series_medium(&mut self, series: &str, medium: Medium) -> Result<usize> {
        ensure!(medium != Medium::Novel, "Comic shelves cannot be classified as novels");
        let wanted = Self::normalized_identity_text(series);
        ensure!(!wanted.is_empty(), "Series name is empty");
        let books = self.list_books(false)?;
        let mut changed = 0usize;
        for book in books.into_iter().filter(|book| book.kind != BookKind::Novel && Self::normalized_identity_text(&book.series) == wanted) {
            if book.metadata.medium == medium || book.metadata.classification.as_ref().is_some_and(|d| d.locked) { continue; }
            let mut record = self.get(&book.id)?;
            record.book.metadata.medium = medium;
            if record.book.metadata.metadata_source.trim().is_empty() || record.book.metadata.metadata_source == "Filename metadata" {
                record.book.metadata.metadata_source = "Online series identification".into();
            }
            self.put(&record)?;
            changed += 1;
        }
        Ok(changed)
    }

    pub fn edit_book(&mut self, id: &str, edit: EditBook) -> Result<Book> {
        let mut record = self.get(id)?;
        let previous_medium = record.book.metadata.medium;
        let title = edit.title.trim();
        let series = edit.series.split_whitespace().collect::<Vec<_>>().join(" ");
        ensure!(!title.is_empty() && title.len() <= 512 && !series.is_empty() && series.len() <= 512, "Use a title and shelf name between 1 and 512 bytes");
        for number in [edit.volume, edit.chapter].into_iter().flatten() {
            ensure!(number.is_finite() && (0.0..=1_000_000.0).contains(&number), "Invalid chapter or volume number");
        }
        record.book.title = title.into(); record.book.series = series;
        record.book.volume = edit.volume; record.book.chapter = edit.chapter;
        record.book.metadata.author = edit.author.trim().to_string();
        record.book.metadata.publisher = edit.publisher.trim().to_string();
        record.book.metadata.language = edit.language.trim().to_string();
        record.book.metadata.genres = edit.genres.into_iter().map(|g| g.trim().to_string()).filter(|g| !g.is_empty()).collect();
        record.book.metadata.description = edit.description.trim().to_string();
        record.book.metadata.source_url = edit.source_url.trim().to_string();
        record.book.metadata.medium = if record.book.kind == BookKind::Novel { Medium::Novel } else { edit.medium };
        self.put(&record)?;
        if record.book.kind != BookKind::Novel && previous_medium != edit.medium {
            let decision = ClassificationDecision { medium: if edit.medium == Medium::Webtoon { Medium::Unknown } else { edit.medium },
                layout: if edit.medium == Medium::Webtoon { "longstrip".into() } else { record.book.metadata.classification.as_ref().map(|d| d.layout.clone()).unwrap_or_else(|| "unknown".into()) },
                status: "confirmed".into(), source: "User-confirmed shelf type".into(), locked: true, version: 2, ..Default::default() };
            self.apply_classification(id, decision)?;
            return Ok(self.get(id)?.book);
        }
        Ok(record.book)
    }

    pub fn remove_book(&mut self, id: &str) -> Result<Option<String>> {
        let record = self.get(id)?; // Requires the key for private books, even on delete.
        self.db.execute("DELETE FROM books WHERE id=?1", [id])?;
        self.db.execute("DELETE FROM watched_files WHERE book_id=?1", [id])?;
        let path = self.root.join("books").join(&record.storage_id);
        match fs::remove_dir_all(path) {
            Ok(()) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Ok(Some("Removed from the library, but some managed files could not be deleted. Close the app and inspect the app-data folder.".into())),
        }
    }

    pub fn transfer_book(&mut self, id: &str, private: bool) -> Result<TransferResult> {
        let mut record = self.get(id)?;
        ensure!(record.book.is_private != private, "Comic is already in that library");
        let key = Zeroizing::new(*self.key()?); // Require an unlocked vault in BOTH directions.
        let old_storage = record.storage_id.clone();
        let storage = Uuid::new_v4().to_string();
        let stage = self.root.join("staging").join(&storage);
        let destination = self.root.join("books").join(&storage);
        importer::secure_dir(&stage)?;
        let result = (|| -> Result<()> {
            for name in &record.resources {
                let plain = self.resource(&record, name)?;
                importer::store_resource(&stage, id, name, &plain, if private { Some(&key) } else { None })?;
            }
            record.storage_id = storage;
            record.book.is_private = private;
            fs::rename(&stage, &destination)?;
            self.put(&record)?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&stage); let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        let cleanup_warning = fs::remove_dir_all(self.root.join("books").join(old_storage)).err().map(|_| {
            "The transfer succeeded, but the previous managed copy could not be removed. That copy may still be readable. Inspect the app-data folder before relying on privacy.".to_string()
        });
        Ok(TransferResult { book: record.book, cleanup_warning })
    }

    fn watchable_file(path: &Path) -> bool {
        matches!(path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
            "cbz" | "zip" | "pdf" | "docx" | "epub" | "txt")
    }

    fn watch_file_stamp(path: &Path) -> Result<(u64, u64)> {
        let metadata = fs::metadata(path)?;
        let modified_ms = metadata.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis().min(u64::MAX as u128) as u64).unwrap_or(0);
        Ok((metadata.len(), modified_ms))
    }

    fn normalized_identity_text(value: &str) -> String {
        value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
    }

    /// Decide whether a watched file represents a chapter/volume that is already in the
    /// normal library. This intentionally uses library identity rather than source path: a
    /// user may first import files manually, then later choose the folder those same files
    /// came from. In that case the watcher adopts the existing managed copy instead of
    /// creating another Book row.
    fn watched_path_matches_book(path: &Path, book: &Book) -> bool {
        if book.is_private { return false; }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let parsed = naming::parse_name(stem);
        if parsed.volume.is_none() && parsed.chapter.is_none() && book.kind == BookKind::Novel {
            let parsed_title = Self::normalized_identity_text(&parsed.title);
            let stem_text = Self::normalized_identity_text(stem);
            return parsed_title == Self::normalized_identity_text(&book.title)
                || stem_text == Self::normalized_identity_text(&book.title)
                || parsed_title == Self::normalized_identity_text(&book.series);
        }
        if Self::normalized_identity_text(&parsed.series) != Self::normalized_identity_text(&book.series) {
            return false;
        }

        match (parsed.volume, parsed.chapter) {
            (Some(volume), Some(chapter)) => book.volume == Some(volume) && book.chapter == Some(chapter),
            (Some(volume), None) => book.volume == Some(volume) && book.chapter.is_none(),
            (None, Some(chapter)) => book.chapter == Some(chapter),
            (None, None) => Self::normalized_identity_text(&parsed.title) == Self::normalized_identity_text(&book.title),
        }
    }

    pub fn list_watched_folders(&mut self) -> Result<Vec<WatchedFolder>> {
        let mut statement = self.db.prepare("SELECT id,path,added_at FROM watched_folders ORDER BY added_at,id")?;
        let rows = statement.query_map([], |r| Ok(WatchedFolder {
            id: r.get(0)?, path: r.get(1)?, added_at: r.get::<_, i64>(2)?.max(0) as u64,
        }))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn add_watched_folder(&mut self, path: PathBuf) -> Result<WatchedFolder> {
        ensure!(path.is_dir(), "Choose a folder containing supported comics or novels");
        ensure!(!fs::symlink_metadata(&path)?.file_type().is_symlink(), "Select the real library folder, not a symbolic link");
        let path = fs::canonicalize(path).context("Could not open that library folder")?;
        let path_text = path.to_string_lossy().to_string();
        if let Some(existing) = self.db.query_row(
            "SELECT id,path,added_at FROM watched_folders WHERE path=?1", [&path_text],
            |r| Ok(WatchedFolder { id: r.get(0)?, path: r.get(1)?, added_at: r.get::<_, i64>(2)?.max(0) as u64 })
        ).optional()? { return Ok(existing); }
        let folder = WatchedFolder { id: Uuid::new_v4().to_string(), path: path_text, added_at: now_ms() };
        self.db.execute("INSERT INTO watched_folders(id,path,added_at) VALUES(?1,?2,?3)",
            params![&folder.id, &folder.path, folder.added_at as i64])?;
        Ok(folder)
    }

    pub fn remove_watched_folder(&mut self, id: &str) -> Result<()> {
        Uuid::parse_str(id).context("Invalid watched-folder ID")?;
        ensure!(self.db.execute("DELETE FROM watched_folders WHERE id=?1", [id])? > 0, "Watched folder not found");
        Ok(())
    }

    pub fn sync_watched_folders(&mut self) -> Result<WatchSyncResult> {
        let folders = self.list_watched_folders()?;
        let mut result = WatchSyncResult::default();
        // Snapshot existing public books once. New imports are appended below so two watched
        // folders cannot create the same logical chapter during the same sync pass either.
        let mut existing_books = self.list_books(false)?;
        for folder in folders {
            let root = PathBuf::from(&folder.path);
            if !root.is_dir() {
                if result.errors.len() < 50 { result.errors.push(format!("{} is unavailable", folder.path)); }
                continue;
            }
            let mut count = 0usize;
            for entry in walkdir::WalkDir::new(&root).follow_links(false).max_depth(16) {
                let entry = match entry {
                    Ok(v) => v,
                    Err(e) => { if result.errors.len() < 50 { result.errors.push(format!("{}: {e}", folder.path)); } continue; }
                };
                if !entry.file_type().is_file() || !Self::watchable_file(entry.path()) { continue; }
                if entry.path().strip_prefix(&root).ok().is_some_and(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))) { continue; }
                count += 1;
                if count > 5000 {
                    result.errors.push(format!("{} contains more than 5000 supported library files; split it into smaller watched folders", folder.path));
                    break;
                }
                let path = match fs::canonicalize(entry.path()) { Ok(p) => p, Err(e) => { if result.errors.len() < 50 { result.errors.push(format!("{}: {e}", entry.path().display())); } continue; } };
                let path_text = path.to_string_lossy().to_string();
                let (size, modified_ms) = match Self::watch_file_stamp(&path) { Ok(v) => v, Err(e) => { if result.errors.len() < 50 { result.errors.push(format!("{}: {e:#}", path.display())); } continue; } };
                let tracked: Option<(String, i64, i64)> = self.db.query_row(
                    "SELECT book_id,size,modified_ms FROM watched_files WHERE path=?1", [&path_text],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                ).optional()?;
                if tracked.as_ref().is_some_and(|(_, old_size, old_mtime)| *old_size == size as i64 && *old_mtime == modified_ms as i64) { continue; }

                // First scan of a file: if the same series + chapter/volume already exists
                // because it was imported manually, adopt that Book instead of duplicating it.
                if tracked.is_none() {
                    if let Some(existing) = existing_books.iter().find(|book| Self::watched_path_matches_book(&path, book)) {
                        self.db.execute("INSERT INTO watched_files(path,watch_id,book_id,size,modified_ms) VALUES(?1,?2,?3,?4,?5)
                            ON CONFLICT(path) DO UPDATE SET watch_id=excluded.watch_id,book_id=excluded.book_id,size=excluded.size,modified_ms=excluded.modified_ms",
                            params![&path_text, &folder.id, &existing.id, size as i64, modified_ms as i64])?;
                        result.matched_existing += 1;
                        continue;
                    }
                }

                match self.import_one(&path, false) {
                    Ok(book) => {
                        if let Some((old_id, _, _)) = &tracked {
                            let _ = self.remove_book(old_id);
                        }
                        self.db.execute("INSERT INTO watched_files(path,watch_id,book_id,size,modified_ms) VALUES(?1,?2,?3,?4,?5)\n                            ON CONFLICT(path) DO UPDATE SET watch_id=excluded.watch_id,book_id=excluded.book_id,size=excluded.size,modified_ms=excluded.modified_ms",
                            params![&path_text, &folder.id, &book.id, size as i64, modified_ms as i64])?;
                        existing_books.retain(|candidate| match tracked.as_ref() { Some((old_id, _, _)) => candidate.id != *old_id, None => true });
                        existing_books.push(book.clone());
                        result.imported.push(book);
                    }
                    Err(e) => if result.errors.len() < 50 { result.errors.push(format!("{}: {e:#}", path.file_name().unwrap_or_default().to_string_lossy())); },
                }
            }
        }
        Ok(result)
    }

    pub fn music_snapshot(&mut self) -> Result<MusicSnapshot> {
        let tracks = {
            let mut statement = self.db.prepare("SELECT id,title,added_at FROM music_tracks ORDER BY added_at,id")?;
            let rows = statement.query_map([], |r| Ok(MusicTrack { id: r.get(0)?, title: r.get(1)?, added_at: r.get::<_, i64>(2)?.max(0) as u64 }))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let playlist_rows: Vec<(String, String)> = {
            let mut statement = self.db.prepare("SELECT id,name FROM music_playlists ORDER BY created_at,id")?;
            let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let mut playlists = Vec::with_capacity(playlist_rows.len());
        for (id, name) in playlist_rows {
            let track_ids = {
                let mut statement = self.db.prepare("SELECT track_id FROM music_playlist_tracks WHERE playlist_id=?1 ORDER BY position,track_id")?;
                let rows = statement.query_map([&id], |r| r.get(0))?;
                rows.collect::<std::result::Result<Vec<String>, _>>()?
            };
            playlists.push(MusicPlaylist { id, name, track_ids });
        }
        Ok(MusicSnapshot { tracks, playlists })
    }

    pub fn import_music_paths(&mut self, paths: Vec<PathBuf>) -> Result<Vec<MusicTrack>> {
        ensure!(paths.len() <= 200, "Import at most 200 MP3 files at once");
        let mut imported = Vec::new();
        for path in paths {
            ensure!(path.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("mp3")), "Only MP3 files are supported");
            ensure!(!fs::symlink_metadata(&path)?.file_type().is_symlink(), "Select the original MP3, not a symbolic link");
            let metadata = fs::metadata(&path)?;
            ensure!(metadata.is_file() && metadata.len() > 0 && metadata.len() <= MAX_MUSIC_BYTES, "MP3 must be between 1 byte and 150 MB");
            let id = Uuid::new_v4().to_string();
            let target = self.root.join("music").join(format!("{id}.mp3"));
            let stage = self.root.join("staging").join(format!("music-{id}.mp3"));
            fs::copy(&path, &stage).with_context(|| format!("Could not copy {}", path.display()))?;
            fs::rename(&stage, &target).or_else(|_| { fs::copy(&stage, &target)?; fs::remove_file(&stage) })?;
            let title = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled track").trim().to_string();
            let title = if title.is_empty() { "Untitled track".to_string() } else { title.chars().take(300).collect() };
            let track = MusicTrack { id: id.clone(), title, added_at: now_ms() };
            if let Err(error) = self.db.execute("INSERT INTO music_tracks(id,title,added_at) VALUES(?1,?2,?3)", params![&track.id, &track.title, track.added_at as i64]) {
                let _ = fs::remove_file(&target);
                return Err(error.into());
            }
            imported.push(track);
        }
        Ok(imported)
    }

    pub fn read_music_track(&mut self, id: &str) -> Result<Vec<u8>> {
        Uuid::parse_str(id).context("Invalid music track ID")?;
        let exists: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM music_tracks WHERE id=?1)", [id], |r| r.get(0))?;
        ensure!(exists, "Music track not found");
        Ok(importer::read_limited(File::open(self.root.join("music").join(format!("{id}.mp3"))).context("Managed MP3 data is missing; reimport the original")?, MAX_MUSIC_BYTES)?.to_vec())
    }

    pub fn create_music_playlist(&mut self, name: String) -> Result<MusicPlaylist> {
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        ensure!(!name.is_empty() && name.chars().count() <= 80, "Playlist name must be between 1 and 80 characters");
        let id = Uuid::new_v4().to_string();
        self.db.execute("INSERT INTO music_playlists(id,name,created_at) VALUES(?1,?2,?3)", params![&id, &name, now_ms() as i64])?;
        Ok(MusicPlaylist { id, name, track_ids: Vec::new() })
    }

    pub fn delete_music_playlist(&mut self, id: &str) -> Result<()> {
        Uuid::parse_str(id).context("Invalid playlist ID")?;
        ensure!(self.db.execute("DELETE FROM music_playlists WHERE id=?1", [id])? > 0, "Playlist not found");
        Ok(())
    }

    pub fn set_music_playlist_tracks(&mut self, id: &str, track_ids: Vec<String>) -> Result<()> {
        Uuid::parse_str(id).context("Invalid playlist ID")?;
        ensure!(track_ids.len() <= 5000, "Playlist is too large");
        let exists: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM music_playlists WHERE id=?1)", [id], |r| r.get(0))?;
        ensure!(exists, "Playlist not found");
        let mut seen = std::collections::HashSet::new();
        for track_id in &track_ids {
            Uuid::parse_str(track_id).context("Invalid music track ID")?;
            ensure!(seen.insert(track_id.clone()), "A playlist cannot contain the same track twice");
            let track_exists: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM music_tracks WHERE id=?1)", [track_id], |r| r.get(0))?;
            ensure!(track_exists, "A playlist track no longer exists");
        }
        let transaction = self.db.transaction()?;
        transaction.execute("DELETE FROM music_playlist_tracks WHERE playlist_id=?1", [id])?;
        for (position, track_id) in track_ids.iter().enumerate() {
            transaction.execute("INSERT INTO music_playlist_tracks(playlist_id,track_id,position) VALUES(?1,?2,?3)", params![id, track_id, position as i64])?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_music_track(&mut self, id: &str) -> Result<()> {
        Uuid::parse_str(id).context("Invalid music track ID")?;
        ensure!(self.db.execute("DELETE FROM music_tracks WHERE id=?1", [id])? > 0, "Music track not found");
        match fs::remove_file(self.root.join("music").join(format!("{id}.mp3"))) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    fn fixture(folder: &Path) -> PathBuf {
        let p = folder.join("Secret Story Vol 01.png");
        image::RgbImage::from_pixel(4, 6, image::Rgb([30, 100, 60])).save(&p).unwrap(); p
    }
    #[test] fn public_import_progress_and_reopen() {
        let dir = tempdir().unwrap(); let original = fixture(dir.path());
        let root = dir.path().join("library");
        let mut store = Store::open(&root).unwrap();
        let book = store.import_one(&original, false).unwrap();
        assert_eq!(book.series, "Secret Story"); assert_eq!(book.pages.len(), 1);
        let p = Progress { offset: 0.45, mode: ReadingMode::Scroll, ..Progress::default() };
        store.save_progress(&book.id, p.clone()).unwrap();
        assert!(store.read_page(&book.id, 1).is_err());
        drop(store);
        let mut store = Store::open(root).unwrap();
        assert_eq!(store.list_books(false).unwrap()[0].progress, p);
        store.remove_book(&book.id).unwrap(); assert!(original.exists());
    }
    #[test] fn private_files_and_metadata_are_encrypted_and_access_is_gated() {
        let dir = tempdir().unwrap(); let original = fixture(dir.path());
        let root = dir.path().join("library");
        let mut store = Store::open(&root).unwrap();
        store.create_vault("a long private passphrase".into()).unwrap();
        let book = store.import_one(&original, true).unwrap();
        assert!(store.list_books(false).unwrap().is_empty());
        let encrypted = fs::read(root.join("books").join(&book.id).join("page-00000.bin")).unwrap();
        assert!(encrypted.starts_with(b"IPPO1")); assert!(!encrypted.starts_with(b"\x89PNG"));
        let db_bytes = fs::read(root.join("library.sqlite")).unwrap();
        assert!(!db_bytes.windows(12).any(|s| s == b"Secret Story"));
        let original_bytes = fs::read(&original).unwrap();
        assert_eq!(store.read_page(&book.id, 0).unwrap(), original_bytes);
        store.lock_vault();
        assert!(store.list_books(true).is_err()); assert!(store.read_page(&book.id, 0).is_err());
        assert!(store.read_cover(&book.id).is_err()); assert!(store.remove_book(&book.id).is_err());
        store.unlock_vault("a long private passphrase".into()).unwrap();
        assert_eq!(store.read_page(&book.id, 0).unwrap(), original_bytes);
    }

    #[test] fn recovery_backup_and_reset_preserve_normal_library() {
        let dir = tempdir().unwrap();
        let private_source = fixture(dir.path());
        let normal_source = dir.path().join("Normal Story Ch 01.png");
        image::RgbImage::from_pixel(4, 6, image::Rgb([80, 40, 120])).save(&normal_source).unwrap();
        let root = dir.path().join("library");
        let backup_root = dir.path().join("backups"); fs::create_dir_all(&backup_root).unwrap();
        let mut store = Store::open(&root).unwrap();
        store.create_vault("correct horse battery staple".into()).unwrap();
        let private_book = store.import_one(&private_source, true).unwrap();
        let normal_book = store.import_one(&normal_source, false).unwrap();
        store.lock_vault();
        let backup = store.export_vault_backup(&backup_root).unwrap();
        assert!(backup.join("vault").join("verifier.bin").exists());
        assert!(backup.join("records").join("books").join(format!("{}.bin", private_book.id)).exists());
        let result = store.reset_vault().unwrap();
        assert!(!store.vault_status().unwrap().configured);
        assert_eq!(store.list_books(false).unwrap().len(), 1);
        assert_eq!(store.list_books(false).unwrap()[0].id, normal_book.id);
        assert!(!root.join("books").join(&private_book.id).exists());
        store.create_vault("a brand new private passphrase".into()).unwrap();
        assert!(store.vault_status().unwrap().unlocked);
        let _ = result;
    }

    #[test] fn wrong_password_does_not_unlock() {
        let dir = tempdir().unwrap(); let mut store = Store::open(dir.path()).unwrap();
        store.create_vault("correct horse battery staple".into()).unwrap(); store.lock_vault();
        assert!(store.unlock_vault("incorrect passphrase".into()).is_err());
        assert!(!store.vault_status().unwrap().unlocked);
    }
    #[test] fn transfers_preserve_progress_and_originals() {
        let dir = tempdir().unwrap(); let original = fixture(dir.path());
        let mut store = Store::open(dir.path().join("library")).unwrap();
        store.create_vault("correct horse battery staple".into()).unwrap();
        let book = store.import_one(&original, false).unwrap();
        let bytes = store.read_page(&book.id, 0).unwrap();
        store.transfer_book(&book.id, true).unwrap();
        assert_eq!(store.list_books(true).unwrap().len(), 1);
        store.transfer_book(&book.id, false).unwrap(); store.lock_vault();
        assert_eq!(store.read_page(&book.id, 0).unwrap(), bytes); assert!(original.exists());
    }
    #[test] fn idle_timeout_drops_key() {
        let dir = tempdir().unwrap(); let mut store = Store::open(dir.path()).unwrap();
        store.create_vault("correct horse battery staple".into()).unwrap();
        store.session.as_mut().unwrap().last_activity = Instant::now() - IDLE_TIMEOUT;
        assert!(store.expire_vault()); assert!(!store.vault_status().unwrap().unlocked);
    }
    #[test] fn rejects_invalid_progress() {
        let dir = tempdir().unwrap(); let original = fixture(dir.path());
        let mut store = Store::open(dir.path().join("library")).unwrap();
        let book = store.import_one(&original, false).unwrap();
        assert!(store.save_progress(&book.id, Progress { offset: f64::NAN, ..Progress::default() }).is_err());
        assert!(store.save_progress(&book.id, Progress { page: 3, ..Progress::default() }).is_err());
    }
    #[test] fn online_classification_updates_every_public_book_in_a_series() {
        let dir = tempdir().unwrap();
        let first = dir.path().join("Korean Story Ch 01.png");
        let second = dir.path().join("Korean Story Ch 02.png");
        image::RgbImage::from_pixel(4, 6, image::Rgb([30, 60, 90])).save(&first).unwrap();
        image::RgbImage::from_pixel(4, 6, image::Rgb([40, 70, 100])).save(&second).unwrap();
        let mut store = Store::open(dir.path().join("library")).unwrap();
        store.import_one(&first, false).unwrap(); store.import_one(&second, false).unwrap();
        assert_eq!(store.set_series_medium("korean   story", Medium::Manhwa).unwrap(), 2);
        let books = store.list_books(false).unwrap();
        assert!(books.iter().all(|book| book.metadata.medium == Medium::Manhwa));
        assert_eq!(store.set_series_medium("Korean Story", Medium::Manhwa).unwrap(), 0);
    }

    #[test] fn custom_shelf_cover_is_managed_independently_of_source_file() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("shelf.png");
        image::RgbImage::from_pixel(80, 120, image::Rgb([180, 70, 90])).save(&source).unwrap();
        let mut store = Store::open(dir.path().join("library")).unwrap();
        store.set_shelf_cover("Hajime no Ippo", false, &source).unwrap();
        fs::remove_file(&source).unwrap();
        let saved = store.read_shelf_cover("hajime   no   ippo", false).unwrap();
        assert!(saved.starts_with(&[0xff, 0xd8, 0xff]));
        assert!(store.remove_shelf_cover("Hajime no Ippo", false).unwrap());
        assert!(store.read_shelf_cover("Hajime no Ippo", false).is_err());
    }
    #[test] fn music_import_is_managed_and_playlists_keep_order() {
        let dir = tempdir().unwrap();
        let first = dir.path().join("Rain Theme.mp3");
        let second = dir.path().join("Fight Theme.mp3");
        fs::write(&first, b"ID3managed-track-one").unwrap();
        fs::write(&second, b"ID3managed-track-two").unwrap();
        let root = dir.path().join("library");
        let mut store = Store::open(&root).unwrap();
        let tracks = store.import_music_paths(vec![first.clone(), second.clone()]).unwrap();
        assert_eq!(tracks.len(), 2);
        fs::remove_file(first).unwrap(); fs::remove_file(second).unwrap();
        assert_eq!(store.read_music_track(&tracks[0].id).unwrap(), b"ID3managed-track-one");
        let playlist = store.create_music_playlist("Reading Mix".into()).unwrap();
        store.set_music_playlist_tracks(&playlist.id, vec![tracks[1].id.clone(), tracks[0].id.clone()]).unwrap();
        drop(store);
        let mut store = Store::open(root).unwrap();
        let snapshot = store.music_snapshot().unwrap();
        assert_eq!(snapshot.tracks.len(), 2);
        assert_eq!(snapshot.playlists[0].track_ids, vec![tracks[1].id.clone(), tracks[0].id.clone()]);
        store.delete_music_track(&tracks[1].id).unwrap();
        assert_eq!(store.music_snapshot().unwrap().playlists[0].track_ids, vec![tracks[0].id.clone()]);
    }
}
