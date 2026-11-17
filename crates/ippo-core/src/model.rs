use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction { #[default] Ltr, Rtl }

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReadingMode { #[default] Paged, Scroll }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub page: usize,
    pub offset: f64,
    pub mode: ReadingMode,
    pub direction: Direction,
    pub zoom: f64,
}
impl Default for Progress {
    fn default() -> Self {
        Self { page: 0, offset: 0.0, mode: ReadingMode::Paged, direction: Direction::Ltr, zoom: 1.0 }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSize { pub width: u32, pub height: u32, pub mime: String }

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BookKind { Images, Pdf, Novel }

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Medium {
    #[default]
    Unknown,
    Comic,
    Manga,
    Manhwa,
    Manhua,
    Webtoon,
    Novel,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BookMetadata {
    pub author: String,
    pub publisher: String,
    pub language: String,
    pub genres: Vec<String>,
    pub description: String,
    pub source_url: String,
    pub medium: Medium,
    pub metadata_source: String,
    pub tags: Vec<String>,
    pub alternate_titles: Vec<String>,
    pub original_language: String,
    pub country_of_origin: String,
    pub publication_format: String,
    pub manga_indicator: String,
    pub source_filename: String,
    pub metadata_warnings: Vec<String>,
    pub metadata_revision: u32,
    pub classification: Option<ClassificationDecision>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub title_hint: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub series_hint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume_hint: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter_hint: Option<f64>,
}

/// Separate origin/category from presentation format. No inferred certainty percentage.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClassificationDecision {
    pub medium: Medium,
    pub layout: String,
    pub status: String,
    pub source: String,
    pub evidence: Vec<String>,
    pub warnings: Vec<String>,
    pub candidate_id: String,
    pub aliases: Vec<String>,
    pub original_language: String,
    pub locked: bool,
    pub version: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub series: String,
    pub volume: Option<f64>,
    pub chapter: Option<f64>,
    pub kind: BookKind,
    pub format: String,
    pub pages: Vec<PageSize>,
    pub has_cover: bool,
    pub progress: Progress,
    pub last_read: u64,
    pub added_at: u64,
    pub is_private: bool,
    #[serde(default)]
    pub metadata: BookMetadata,
    #[serde(default)]
    pub reading_seconds: u64,
    #[serde(default)]
    pub word_count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditBook {
    pub title: String,
    pub series: String,
    pub volume: Option<f64>,
    pub chapter: Option<f64>,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub medium: Medium,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelChapter {
    pub title: String,
    pub text: String,
    pub word_count: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelDocument {
    pub chapters: Vec<NovelChapter>,
    pub word_count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct StoredBook {
    pub book: Book,
    pub storage_id: String,
    pub resources: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus { pub configured: bool, pub unlocked: bool }

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultResetResult { pub warnings: Vec<String> }

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: Vec<Book>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult { pub book: Book, pub cleanup_warning: Option<String> }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrack { pub id: String, pub title: String, pub added_at: u64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlaylist { pub id: String, pub name: String, pub track_ids: Vec<String> }

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicSnapshot { pub tracks: Vec<MusicTrack>, pub playlists: Vec<MusicPlaylist> }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub id: String,
    pub path: String,
    pub added_at: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSyncResult {
    pub imported: Vec<Book>,
    pub matched_existing: usize,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCard {
    pub provider: String,
    pub title: String,
    pub score: Option<f64>,
    pub body: String,
    pub url: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediumDetection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub medium: Option<Medium>,
    pub matched_title: String,
    pub source: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesReviewBundle {
    pub cards: Vec<ReviewCard>,
    pub matched_title: String,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_medium: Option<Medium>,
    pub classification_source: String,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_millis().min(u64::MAX as u128) as u64
}
