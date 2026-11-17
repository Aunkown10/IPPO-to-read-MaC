use crate::{crypto, model::{BookKind, BookMetadata, Medium, NovelChapter, NovelDocument, PageSize}};
use anyhow::{bail, ensure, Context, Result};
use image::{codecs::jpeg::JpegEncoder, ImageFormat, ImageReader};
use std::{collections::{HashMap, HashSet}, fs::{self, File, OpenOptions}, io::{Cursor, Read, Write}, path::{Path, PathBuf}};
use walkdir::WalkDir;
use zeroize::Zeroizing;
use zip::ZipArchive;

pub const MAX_PAGE_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_XML_BYTES: u64 = 8 * 1024 * 1024;
const MAX_NOVEL_BYTES: u64 = 24 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;

pub struct ImportedContent {
    pub kind: BookKind,
    pub pages: Vec<PageSize>,
    pub resources: Vec<String>,
    pub has_cover: bool,
    pub metadata: BookMetadata,
    pub word_count: u64,
}

pub fn image_name(name: &str) -> bool {
    matches!(Path::new(name).extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif")
}

pub fn read_limited(mut reader: impl Read, limit: u64) -> Result<Zeroizing<Vec<u8>>> {
    let mut bytes = Zeroizing::new(Vec::new());
    reader.by_ref().take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "File exceeds the allowed size limit");
    Ok(bytes)
}

pub fn secure_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut opts = OpenOptions::new(); opts.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; opts.mode(0o600); }
    let mut f = opts.open(path)?;
    f.write_all(bytes)?; f.sync_all()?;
    Ok(())
}

pub fn context(book_id: &str, name: &str) -> Vec<u8> { format!("ippo/v1/{book_id}/{name}").into_bytes() }

pub fn store_resource(dir: &Path, book_id: &str, name: &str, data: &[u8], key: Option<&[u8; 32]>) -> Result<()> {
    match key {
        Some(k) => write_new(&dir.join(name), &crypto::seal(k, data, &context(book_id, name))?),
        None => write_new(&dir.join(name), data),
    }
}

fn word_count(text: &str) -> u64 { text.split_whitespace().count() as u64 }

fn clean_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !previous_space { out.push(' '); previous_space = true; }
        } else { out.push(ch); previous_space = false; }
    }
    out.trim().to_string()
}

struct Writer<'a> {
    dir: &'a Path, id: &'a str, key: Option<&'a [u8; 32]>,
    pages: Vec<PageSize>, resources: Vec<String>, total: u64, has_cover: bool,
}
impl<'a> Writer<'a> {
    fn new(dir: &'a Path, id: &'a str, key: Option<&'a [u8; 32]>) -> Self {
        Self { dir, id, key, pages: vec![], resources: vec![], total: 0, has_cover: false }
    }
    fn store_cover(&mut self, bytes: &[u8]) -> Result<()> {
        if self.has_cover { return Ok(()); }
        let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
        let (width, height) = reader.into_dimensions()?;
        ensure!(width > 0 && height > 0 && u64::from(width) * u64::from(height) <= MAX_PIXELS, "Cover dimensions exceed 40 megapixels");
        let small = image::load_from_memory(bytes)?.thumbnail(420, 640).to_rgb8();
        let mut cover = Zeroizing::new(Vec::new());
        JpegEncoder::new_with_quality(&mut *cover, 84).encode_image(&image::DynamicImage::ImageRgb8(small))?;
        store_resource(self.dir, self.id, "cover.bin", &cover, self.key)?;
        self.resources.push("cover.bin".into()); self.has_cover = true;
        Ok(())
    }
    fn push_image(&mut self, bytes: &[u8]) -> Result<()> {
        ensure!(bytes.len() as u64 <= MAX_PAGE_BYTES, "An image exceeds 32 MiB");
        self.total += bytes.len() as u64;
        ensure!(self.total <= MAX_TOTAL_BYTES, "Expanded comic exceeds 1 GiB");
        let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
        let format = reader.format().context("Unrecognized image format")?;
        let mime = match format {
            ImageFormat::Jpeg => "image/jpeg", ImageFormat::Png => "image/png",
            ImageFormat::WebP => "image/webp", ImageFormat::Gif => "image/gif",
            _ => bail!("Unsupported embedded image; use JPEG, PNG, WebP or GIF"),
        };
        let (width, height) = reader.into_dimensions()?;
        ensure!(width > 0 && height > 0 && u64::from(width) * u64::from(height) <= MAX_PIXELS,
            "Image dimensions exceed 40 megapixels");
        let name = format!("page-{:05}.bin", self.pages.len());
        store_resource(self.dir, self.id, &name, bytes, self.key)?;
        self.resources.push(name);
        if self.pages.is_empty() { self.store_cover(bytes)?; }
        self.pages.push(PageSize { width, height, mime: mime.into() });
        Ok(())
    }
    fn finish(self, metadata: BookMetadata) -> Result<ImportedContent> {
        ensure!(!self.pages.is_empty(), "No supported comic images were found");
        Ok(ImportedContent { kind: BookKind::Images, pages: self.pages, resources: self.resources, has_cover: self.has_cover, metadata, word_count: 0 })
    }
    fn finish_novel(mut self, document: NovelDocument, metadata: BookMetadata) -> Result<ImportedContent> {
        ensure!(!document.chapters.is_empty(), "No readable novel text was found");
        let plain = serde_json::to_vec(&document)?;
        ensure!(plain.len() as u64 <= MAX_NOVEL_BYTES, "Extracted novel text exceeds 24 MiB");
        store_resource(self.dir, self.id, "novel.bin", &plain, self.key)?;
        self.resources.push("novel.bin".into());
        let pages = document.chapters.iter().map(|_| PageSize { width: 1, height: 1, mime: "text/plain".into() }).collect();
        Ok(ImportedContent { kind: BookKind::Novel, pages, resources: self.resources, has_cover: self.has_cover, metadata, word_count: document.word_count })
    }
}

fn archive_member(zip: &mut ZipArchive<File>, index: usize, limit: u64) -> Result<Zeroizing<Vec<u8>>> {
    let entry = zip.by_index(index).context("Cannot read ZIP entry (password-protected archives are unsupported)")?;
    ensure!(entry.size() <= limit, "ZIP entry is too large");
    ensure!(entry.enclosed_name().is_some(), "ZIP contains an unsafe path");
    ensure!(entry.unix_mode().unwrap_or(0) & 0o170000 != 0o120000, "ZIP symbolic links are unsupported");
    ensure!(entry.size() == 0 || (entry.compressed_size() > 0 && entry.size() / entry.compressed_size().max(1) <= 2000),
        "Suspicious ZIP compression ratio");
    read_limited(entry, limit)
}

fn archive_inventory(zip: &mut ZipArchive<File>) -> Result<Vec<(usize, String)>> {
    ensure!(zip.len() <= 20_000, "Archive has too many entries");
    let mut entries = Vec::new(); let mut seen = HashSet::new();
    for i in 0..zip.len() {
        let f = zip.by_index(i)?;
        ensure!(f.enclosed_name().is_some(), "ZIP contains an unsafe path");
        ensure!(f.unix_mode().unwrap_or(0) & 0o170000 != 0o120000, "ZIP symbolic links are unsupported");
        let name = f.name().replace('\\', "/");
        ensure!(seen.insert(name.clone()), "ZIP contains duplicate filenames");
        if !f.is_dir() && !name.starts_with("__MACOSX/") && !name.split('/').any(|s| s.starts_with('.')) {
            entries.push((i, name));
        }
    }
    Ok(entries)
}

fn find_entry(entries: &[(usize, String)], wanted: &str) -> Option<usize> {
    entries.iter().find(|(_, n)| n.eq_ignore_ascii_case(wanted)).map(|(i, _)| *i)
}

fn text_of(node: roxmltree::Node<'_, '_>) -> String {
    clean_text(&node.descendants().filter(|n| n.is_text()).filter_map(|n| n.text()).collect::<Vec<_>>().join(" "))
}

fn comicinfo_metadata(xml: &str) -> Result<BookMetadata> {
    let doc = roxmltree::Document::parse(xml)?;
    let root = doc.root_element();
    let get = |name: &str| root.children().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case(name)).map(text_of).unwrap_or_default();
    let manga = get("Manga");
    let split = |value: String| value.split([',', ';']).map(str::trim)
        .filter(|s| !s.is_empty()).map(str::to_string).collect::<Vec<_>>();
    let genres = split(get("Genre"));
    let tags = split(get("Tags"));
    // Keep raw classification evidence for the shared, tested classifier. LanguageISO is
    // the edition's language, NOT necessarily the original language or country.
    let labels: Vec<String> = genres.iter().chain(tags.iter())
        .map(|s| s.to_lowercase()).collect();
    let medium = if labels.iter().any(|x| x == "manhwa") { Medium::Manhwa }
        else if labels.iter().any(|x| x == "manhua") { Medium::Manhua }
        else if labels.iter().any(|x| x == "manga") || manga.eq_ignore_ascii_case("yes")
            || manga.eq_ignore_ascii_case("YesAndRightToLeft") { Medium::Manga }
        else { Medium::Unknown };
    let localized = get("LocalizedSeries");
    Ok(BookMetadata {
        author: get("Writer"), publisher: get("Publisher"), language: get("LanguageISO"), genres,
        tags, description: get("Summary"), source_url: get("Web"), medium,
        metadata_source: "ComicInfo.xml".into(),
        alternate_titles: if localized.is_empty() { vec![] } else { vec![localized] },
        // These are extensions used by some exporters, not required ComicInfo fields.
        original_language: get("OriginalLanguage"), country_of_origin: get("CountryOfOrigin"),
        publication_format: get("Format"), manga_indicator: manga, metadata_revision: 2,
        title_hint: get("Title"), series_hint: get("Series"),
        volume_hint: get("Volume").parse::<f64>().ok(), chapter_hint: get("Number").parse::<f64>().ok(),
        ..Default::default()
    })
}

fn resolve_docx_target(target: &str) -> Option<String> {
    let target = target.replace('\\', "/");
    if target.starts_with('/') || target.contains(':') { return None; }
    let mut parts = vec!["word"];
    for part in target.split('/') {
        match part { "" | "." => {}, ".." => { parts.pop()?; }, value => parts.push(value) }
    }
    let name = parts.join("/");
    if image_name(&name) { Some(name) } else { None }
}

fn docx_metadata(zip: &mut ZipArchive<File>, entries: &[(usize, String)]) -> BookMetadata {
    let Some(index) = find_entry(entries, "docProps/core.xml") else { return BookMetadata { medium: Medium::Novel, ..Default::default() }; };
    let Ok(bytes) = archive_member(zip, index, MAX_XML_BYTES) else { return BookMetadata { medium: Medium::Novel, ..Default::default() }; };
    let Ok(xml) = std::str::from_utf8(&bytes) else { return BookMetadata { medium: Medium::Novel, ..Default::default() }; };
    let Ok(doc) = roxmltree::Document::parse(xml) else { return BookMetadata { medium: Medium::Novel, ..Default::default() }; };
    let get = |name: &str| doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case(name)).map(text_of).unwrap_or_default();
    BookMetadata { author: get("creator"), language: get("language"), description: get("description"), medium: Medium::Novel, metadata_source: "DOCX properties".into(), title_hint: get("title"), ..Default::default() }
}

fn docx_text(zip: &mut ZipArchive<File>, entries: &[(usize, String)]) -> Result<NovelDocument> {
    let index = find_entry(entries, "word/document.xml").context("Not a valid DOCX document")?;
    let bytes = archive_member(zip, index, MAX_XML_BYTES)?;
    let xml = std::str::from_utf8(&bytes).context("DOCX XML is not UTF-8")?;
    let doc = roxmltree::Document::parse(xml)?;
    let mut chapters: Vec<NovelChapter> = Vec::new();
    let mut current_title = "Document".to_string();
    let mut current = String::new();
    for p in doc.descendants().filter(|n| n.is_element() && n.tag_name().name() == "p") {
        let text = clean_text(&p.descendants().filter(|n| n.is_element() && n.tag_name().name() == "t").filter_map(|n| n.text()).collect::<Vec<_>>().join(" "));
        if text.is_empty() { continue; }
        let style = p.descendants().find(|n| n.is_element() && n.tag_name().name() == "pStyle").and_then(|n| n.attribute("val").or_else(|| n.attributes().find(|a| a.name() == "val").map(|a| a.value()))).unwrap_or("");
        let heading = style.to_ascii_lowercase().starts_with("heading") || style.to_ascii_lowercase().starts_with("title");
        if heading && !current.trim().is_empty() {
            let body = current.trim().to_string(); let count = word_count(&body);
            chapters.push(NovelChapter { title: current_title.clone(), text: body, word_count: count });
            current.clear(); current_title = text; continue;
        }
        if heading && current.trim().is_empty() { current_title = text; continue; }
        if !current.is_empty() { current.push_str("\n\n"); }
        current.push_str(&text);
    }
    if !current.trim().is_empty() {
        let body = current.trim().to_string(); let count = word_count(&body);
        chapters.push(NovelChapter { title: current_title, text: body, word_count: count });
    }
    let total = chapters.iter().map(|c| c.word_count).sum();
    Ok(NovelDocument { chapters, word_count: total })
}

fn import_docx_images(zip: &mut ZipArchive<File>, entries: &[(usize, String)], writer: &mut Writer<'_>) -> Result<()> {
    let positions: HashMap<&str, usize> = entries.iter().map(|(i, n)| (n.as_str(), *i)).collect();
    let rel_index = positions.get("word/_rels/document.xml.rels").context("DOCX contains no image relationships")?;
    let doc_index = positions.get("word/document.xml").context("Not a valid DOCX document")?;
    let rel_bytes = archive_member(zip, *rel_index, MAX_XML_BYTES)?;
    let doc_bytes = archive_member(zip, *doc_index, MAX_XML_BYTES)?;
    let rel_xml = std::str::from_utf8(&rel_bytes).context("DOCX XML is not UTF-8")?;
    let doc_xml = std::str::from_utf8(&doc_bytes).context("DOCX XML is not UTF-8")?;
    let relationships = roxmltree::Document::parse(rel_xml)?;
    let document = roxmltree::Document::parse(doc_xml)?;
    let mut images = HashMap::new();
    for n in relationships.descendants().filter(|n| n.tag_name().name() == "Relationship") {
        if n.attribute("TargetMode") == Some("External") { continue; }
        if !n.attribute("Type").unwrap_or("").ends_with("/image") { continue; }
        if let (Some(id), Some(target)) = (n.attribute("Id"), n.attribute("Target")) {
            if let Some(name) = resolve_docx_target(target) { images.insert(id, name); }
        }
    }
    const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const STRICT_REL: &str = "http://purl.oclc.org/ooxml/officeDocument/relationships";
    for n in document.descendants() {
        let attribute = match n.tag_name().name() { "blip" => "embed", "imagedata" => "id", _ => continue };
        let Some(id) = n.attribute((REL, attribute)).or_else(|| n.attribute((STRICT_REL, attribute))) else { continue; };
        let Some(name) = images.get(id) else { continue; };
        let index = positions.get(name.as_str()).context("DOCX refers to a missing embedded image")?;
        writer.push_image(&archive_member(zip, *index, MAX_PAGE_BYTES)?)?;
    }
    Ok(())
}

fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| -> Option<u8> { match b { b'0'..=b'9' => Some(b-b'0'), b'a'..=b'f' => Some(b-b'a'+10), b'A'..=b'F' => Some(b-b'A'+10), _ => None } };
            if let (Some(a), Some(b)) = (hex(bytes[i+1]), hex(bytes[i+2])) { out.push(a * 16 + b); i += 3; continue; }
        }
        out.push(bytes[i]); i += 1;
    }
    String::from_utf8_lossy(&out).replace('\\', "/")
}

fn normalize_zip_path(base_file: &str, href: &str) -> Option<String> {
    let decoded = percent_decode_path(href.split('#').next().unwrap_or(""));
    if decoded.starts_with('/') || decoded.contains(':') { return None; }
    let mut parts: Vec<&str> = base_file.rsplit_once('/').map(|(d, _)| d.split('/').collect()).unwrap_or_default();
    for part in decoded.split('/') {
        match part { "" | "." => {}, ".." => { parts.pop()?; }, value => parts.push(value) }
    }
    Some(parts.join("/"))
}

fn find_epub_entry(entries: &[(usize, String)], wanted: &str) -> Option<usize> {
    let wanted = percent_decode_path(wanted).trim_start_matches('/').to_ascii_lowercase();
    entries.iter().find(|(_, n)| percent_decode_path(n).trim_start_matches('/').to_ascii_lowercase() == wanted).map(|(i, _)| *i)
}

fn markup_string(bytes: &[u8]) -> String {
    metadata_xml(bytes).unwrap_or_else(|_| String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').to_string())
}

fn decode_html_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        rest = &rest[pos..];
        let Some(end) = rest.find(';').filter(|e| *e <= 16) else { out.push('&'); rest = &rest[1..]; continue; };
        let entity = &rest[1..end];
        let decoded = match entity {
            "nbsp" => Some(' '), "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'), "apos" => Some('\''),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32),
            _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        if let Some(ch) = decoded { out.push(ch); } else { out.push_str(&rest[..=end]); }
        rest = &rest[end+1..];
    }
    out.push_str(rest); out
}

fn remove_html_block(mut html: String, tag: &str) -> String {
    loop {
        let lower = html.to_ascii_lowercase();
        let open_pat = format!("<{tag}");
        let close_pat = format!("</{tag}>");
        let Some(start) = lower.find(&open_pat) else { break; };
        let Some(relative_end) = lower[start..].find(&close_pat) else { html.truncate(start); break; };
        let end = start + relative_end + close_pat.len();
        html.replace_range(start..end, " ");
    }
    html
}

fn tolerant_html_text(markup: &str) -> String {
    let markup = remove_html_block(remove_html_block(markup.to_string(), "script"), "style");
    let mut out = String::with_capacity(markup.len());
    let mut in_tag = false; let mut tag = String::new();
    for ch in markup.chars() {
        if ch == '<' { in_tag = true; tag.clear(); continue; }
        if in_tag {
            if ch == '>' {
                let t = tag.trim().trim_start_matches('/').split_whitespace().next().unwrap_or("").to_ascii_lowercase();
                if matches!(t.as_str(), "p" | "div" | "br" | "li" | "blockquote" | "h1" | "h2" | "h3" | "h4" | "section" | "article") { out.push_str("\n\n"); }
                in_tag = false;
            } else { tag.push(ch); }
        } else { out.push(ch); }
    }
    let decoded = decode_html_entities(&out);
    decoded.split("\n\n").map(clean_text).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n")
}

fn chapter_from_markup(markup: &str, number: usize) -> Option<NovelChapter> {
    if let Ok(doc) = roxmltree::Document::parse(markup) {
        let body = doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("body")).unwrap_or(doc.root_element());
        let title = doc.descendants().find(|n| n.is_element() && matches!(n.tag_name().name().to_ascii_lowercase().as_str(), "h1" | "h2" | "title"))
            .map(text_of).filter(|s| !s.is_empty()).unwrap_or_else(|| format!("Chapter {number}"));
        let mut paragraphs = Vec::new();
        for n in body.descendants().filter(|n| n.is_element() && matches!(n.tag_name().name().to_ascii_lowercase().as_str(), "p" | "h1" | "h2" | "h3" | "blockquote" | "li")) {
            let t = text_of(n); if !t.is_empty() { paragraphs.push(t); }
        }
        let text = if paragraphs.is_empty() { text_of(body) } else { paragraphs.join("\n\n") };
        if text.trim().len() >= 20 { let count = word_count(&text); return Some(NovelChapter { title, text, word_count: count }); }
    }
    let text = tolerant_html_text(markup);
    if text.trim().len() < 20 { return None; }
    let title = markup.to_ascii_lowercase().find("<title").and_then(|start| {
        let after = &markup[start..]; let gt = after.find('>')?; let content = &after[gt+1..]; let end = content.to_ascii_lowercase().find("</title>")?;
        let t = tolerant_html_text(&content[..end]); if t.is_empty() { None } else { Some(t) }
    }).unwrap_or_else(|| format!("Chapter {number}"));
    let count = word_count(&text); Some(NovelChapter { title, text, word_count: count })
}

fn epub_container_path(zip: &mut ZipArchive<File>, entries: &[(usize, String)]) -> Result<String> {
    if let Some(index) = find_epub_entry(entries, "META-INF/container.xml") {
        if let Ok(bytes) = archive_member(zip, index, MAX_XML_BYTES) {
            let xml = markup_string(&bytes);
            if let Ok(doc) = roxmltree::Document::parse(&xml) {
                if let Some(path) = doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("rootfile"))
                    .and_then(|n| n.attribute("full-path")) { return Ok(percent_decode_path(path)); }
            }
        }
    }
    let mut opfs: Vec<_> = entries.iter().filter(|(_, n)| n.to_ascii_lowercase().ends_with(".opf")).collect();
    opfs.sort_by_key(|(_, n)| n.len());
    opfs.first().map(|(_, n)| n.clone()).context("EPUB package document is missing")
}

fn epub_metadata_and_document(zip: &mut ZipArchive<File>, entries: &[(usize, String)], writer: &mut Writer<'_>) -> Result<(BookMetadata, NovelDocument)> {
    let opf_path = epub_container_path(zip, entries)?;
    let opf_index = find_epub_entry(entries, &opf_path).context("EPUB package file is missing")?;
    let bytes = archive_member(zip, opf_index, MAX_XML_BYTES)?;
    let xml = markup_string(&bytes);
    let doc = roxmltree::Document::parse(&xml).context("EPUB package metadata is malformed")?;
    let first = |name: &str| doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case(name)).map(text_of).unwrap_or_default();
    let genres: Vec<String> = doc.descendants().filter(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("subject")).map(text_of).filter(|s| !s.is_empty()).collect();
    let calibre_series = doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("meta") && n.attribute("name").is_some_and(|x| x.eq_ignore_ascii_case("calibre:series"))).and_then(|n| n.attribute("content")).unwrap_or("").trim().to_string();
    let calibre_index = doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("meta") && n.attribute("name").is_some_and(|x| x.eq_ignore_ascii_case("calibre:series_index"))).and_then(|n| n.attribute("content")).and_then(|x| x.parse::<f64>().ok());
    let epub3_series_node = doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("meta") && n.attribute("property").is_some_and(|x| x.eq_ignore_ascii_case("belongs-to-collection")));
    let epub3_series = epub3_series_node.map(text_of).unwrap_or_default();
    let epub3_series_id = epub3_series_node.and_then(|n| n.attribute("id")).unwrap_or("").to_string();
    let epub3_index = if epub3_series_id.is_empty() { None } else {
        let refine = format!("#{epub3_series_id}");
        doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("meta") && n.attribute("property").is_some_and(|x| x.eq_ignore_ascii_case("group-position")) && n.attribute("refines") == Some(refine.as_str())).map(text_of).and_then(|x| x.parse::<f64>().ok())
    };
    let series_hint = if !calibre_series.is_empty() { calibre_series } else { epub3_series };
    let mut metadata = BookMetadata {
        author: first("creator"), publisher: first("publisher"), language: first("language"), genres,
        description: first("description"), source_url: String::new(), medium: Medium::Novel, metadata_source: "EPUB package metadata".into(),
        title_hint: first("title"), series_hint, volume_hint: calibre_index.or(epub3_index), chapter_hint: None,
        ..Default::default()
    };
    let mut manifest: HashMap<String, (String, String, String)> = HashMap::new();
    for item in doc.descendants().filter(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("item")) {
        if let (Some(id), Some(href)) = (item.attribute("id"), item.attribute("href")) {
            manifest.insert(id.to_string(), (href.to_string(), item.attribute("media-type").unwrap_or("").into(), item.attribute("properties").unwrap_or("").into()));
        }
    }
    let cover_id = doc.descendants().find(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("meta") && n.attribute("name").is_some_and(|x| x.eq_ignore_ascii_case("cover"))).and_then(|n| n.attribute("content")).map(str::to_string);
    let cover_item = manifest.iter().find(|(_, (_, _, props))| props.split_whitespace().any(|p| p.eq_ignore_ascii_case("cover-image")))
        .or_else(|| cover_id.as_ref().and_then(|id| manifest.get_key_value(id)));
    if let Some((_, (href, _, _))) = cover_item {
        if let Some(path) = normalize_zip_path(&opf_path, href) {
            if let Some(index) = find_epub_entry(entries, &path) {
                if let Ok(bytes) = archive_member(zip, index, MAX_PAGE_BYTES) { let _ = writer.store_cover(&bytes); }
            }
        }
    }
    let mut ordered_ids: Vec<String> = doc.descendants().filter(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("itemref"))
        .filter_map(|n| n.attribute("idref").map(str::to_string)).collect();
    if ordered_ids.is_empty() {
        ordered_ids = manifest.iter().filter(|(_, (href, media, _))| media.to_ascii_lowercase().contains("html") || href.to_ascii_lowercase().ends_with(".xhtml") || href.to_ascii_lowercase().ends_with(".html") || href.to_ascii_lowercase().ends_with(".htm"))
            .map(|(id, _)| id.clone()).collect();
        ordered_ids.sort();
    }
    let mut chapters = Vec::new(); let mut seen_paths = HashSet::new();
    for idref in ordered_ids {
        let Some((href, media, _)) = manifest.get(&idref) else { continue; };
        let lower = href.to_ascii_lowercase();
        if !(media.to_ascii_lowercase().contains("html") || lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm")) { continue; }
        let Some(path) = normalize_zip_path(&opf_path, href) else { continue; };
        if !seen_paths.insert(path.to_ascii_lowercase()) { continue; }
        let Some(index) = find_epub_entry(entries, &path) else { continue; };
        let chapter_bytes = archive_member(zip, index, MAX_XML_BYTES)?;
        let chapter_markup = markup_string(&chapter_bytes);
        if let Some(chapter) = chapter_from_markup(&chapter_markup, chapters.len() + 1) { chapters.push(chapter); }
    }
    if chapters.is_empty() {
        // Last-resort EPUB recovery for books whose manifest/spine is unusual but whose
        // archive still contains ordinary HTML/XHTML reading content.
        let mut html_entries: Vec<_> = entries.iter().filter(|(_, n)| {
            let n = n.to_ascii_lowercase(); n.ends_with(".xhtml") || n.ends_with(".html") || n.ends_with(".htm")
        }).collect();
        html_entries.sort_by(|a,b| natord::compare(&a.1.to_ascii_lowercase(), &b.1.to_ascii_lowercase()));
        for (index, _) in html_entries {
            let bytes = archive_member(zip, *index, MAX_XML_BYTES)?;
            if let Some(chapter) = chapter_from_markup(&markup_string(&bytes), chapters.len() + 1) { chapters.push(chapter); }
        }
    }
    if metadata.publisher.is_empty() { metadata.publisher = first("rights"); }
    let total = chapters.iter().map(|c| c.word_count).sum();
    Ok((metadata, NovelDocument { chapters, word_count: total }))
}

fn metadata_xml(bytes: &[u8]) -> Result<String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        ensure!(bytes.len() % 2 == 0, "Incomplete UTF-16 metadata");
        let little = bytes[0] == 0xff;
        let words: Vec<u16> = bytes[2..].chunks_exact(2).map(|p| {
            if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) }
        }).collect();
        Ok(String::from_utf16(&words).context("Invalid UTF-16 metadata")?)
    } else {
        Ok(std::str::from_utf8(bytes).context("Metadata must use UTF-8 or BOM-marked UTF-16")?
            .trim_start_matches('\u{feff}').to_string())
    }
}

fn comic_archive_metadata(zip: &mut ZipArchive<File>, entries: &[(usize, String)]) -> BookMetadata {
    let found: Vec<_> = entries.iter().filter(|(_, n)| n.rsplit('/').next()
        .is_some_and(|x| x.eq_ignore_ascii_case("ComicInfo.xml"))).collect();
    let root = found.iter().copied().find(|(_, n)| n.eq_ignore_ascii_case("ComicInfo.xml"));
    let entry = root.or_else(|| if found.len() == 1 { Some(found[0]) } else { None });
    let Some((index, _)) = entry else {
        return BookMetadata { metadata_revision: 2, metadata_warnings: vec![if found.is_empty() {
            "No ComicInfo.xml was present. Classification needs another source.".into()
        } else { "Multiple nested ComicInfo.xml files; none was chosen automatically.".into() }], ..Default::default() };
    };
    let result = archive_member(zip, *index, MAX_XML_BYTES)
        .and_then(|bytes| metadata_xml(&bytes)).and_then(|xml| comicinfo_metadata(&xml));
    result.unwrap_or_else(|e| BookMetadata { metadata_revision: 2,
        metadata_warnings: vec![format!("ComicInfo.xml could not be parsed: {e}")], ..Default::default() })
}

/// Reads metadata only; never imports pages or creates another library record.
pub fn read_comic_metadata(path: &Path) -> Result<BookMetadata> {
    ensure!(!fs::symlink_metadata(path)?.file_type().is_symlink(), "Select the original file, not a symbolic link");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    ensure!(ext == "cbz" || ext == "zip", "Choose a CBZ or ZIP containing ComicInfo.xml");
    ensure!(path.metadata()?.len() <= MAX_FILE_BYTES, "File exceeds the import size limit");
    let mut archive = ZipArchive::new(File::open(path)?)?;
    let inventory = archive_inventory(&mut archive)?;
    let mut metadata = comic_archive_metadata(&mut archive, &inventory);
    metadata.source_filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    Ok(metadata)
}

pub fn import_content(path: &Path, dir: &Path, book_id: &str, key: Option<&[u8; 32]>) -> Result<ImportedContent> {
    let mut writer = Writer::new(dir, book_id, key);
    ensure!(!fs::symlink_metadata(path)?.file_type().is_symlink(), "Select the original file, not a symbolic link");
    if path.is_dir() {
        let mut pages: Vec<PathBuf> = Vec::new();
        for entry in WalkDir::new(path).follow_links(false).max_depth(16) {
            let e = entry?;
            if e.file_type().is_file() && image_name(&e.path().to_string_lossy()) {
                pages.push(e.into_path());
            }
        }
        pages.sort_by(|a, b| natord::compare(&a.to_string_lossy().to_lowercase(), &b.to_string_lossy().to_lowercase()));
        for p in pages { writer.push_image(&read_limited(File::open(p)?, MAX_PAGE_BYTES)?)?; }
        return writer.finish(BookMetadata::default());
    }
    ensure!(path.metadata()?.len() <= MAX_FILE_BYTES, "File exceeds 256 MiB");
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "txt" => {
            let bytes = read_limited(File::open(path)?, MAX_NOVEL_BYTES)?;
            let text = String::from_utf8(bytes.to_vec()).context("TXT novel must be UTF-8")?;
            let text = text.trim().to_string(); ensure!(!text.is_empty(), "Text file is empty");
            let count = word_count(&text);
            writer.finish_novel(NovelDocument { chapters: vec![NovelChapter { title: "Book".into(), text, word_count: count }], word_count: count }, BookMetadata { medium: Medium::Novel, metadata_source: "Plain text".into(), ..Default::default() })
        }
        "pdf" => {
            let bytes = read_limited(File::open(path)?, MAX_FILE_BYTES)?;
            ensure!(bytes.iter().take(1024).copied().collect::<Vec<_>>().windows(5).any(|s| s == b"%PDF-"), "Invalid PDF signature");
            store_resource(dir, book_id, "document.bin", &bytes, key)?;
            Ok(ImportedContent { kind: BookKind::Pdf, pages: vec![], resources: vec!["document.bin".into()], has_cover: false, metadata: BookMetadata::default(), word_count: 0 })
        }
        "epub" => {
            let mut archive = ZipArchive::new(File::open(path)?).context("Unable to open EPUB")?;
            let entries = archive_inventory(&mut archive)?;
            match epub_metadata_and_document(&mut archive, &entries, &mut writer) {
                Ok((metadata, document)) if !document.chapters.is_empty() => writer.finish_novel(document, metadata),
                _ => {
                    let mut metadata = BookMetadata::default(); metadata.metadata_source = "EPUB image archive".into();
                    let mut images: Vec<_> = entries.into_iter().filter(|(_, name)| image_name(name)).collect();
                    images.sort_by(|a,b| natord::compare(&a.1.to_lowercase(), &b.1.to_lowercase()).then(a.0.cmp(&b.0)));
                    for (index, _) in images { writer.push_image(&archive_member(&mut archive, index, MAX_PAGE_BYTES)?)?; }
                    writer.finish(metadata)
                }
            }
        }
        "docx" => {
            let mut archive = ZipArchive::new(File::open(path)?).context("Unable to open DOCX")?;
            let entries = archive_inventory(&mut archive)?;
            let metadata = docx_metadata(&mut archive, &entries);
            let document = docx_text(&mut archive, &entries).unwrap_or_default();
            if document.word_count >= 40 {
                writer.finish_novel(document, metadata)
            } else {
                import_docx_images(&mut archive, &entries, &mut writer)?;
                writer.finish(BookMetadata { medium: Medium::Unknown, metadata_source: "DOCX embedded images".into(), ..metadata })
            }
        }
        "cbz" | "zip" => {
            let mut archive = ZipArchive::new(File::open(path)?).context("Unable to open archive")?;
            let mut entries = archive_inventory(&mut archive)?;
            let metadata = comic_archive_metadata(&mut archive, &entries);
            entries.retain(|(_, name)| image_name(name));
            entries.sort_by(|a,b| natord::compare(&a.1.to_lowercase(), &b.1.to_lowercase()).then(a.0.cmp(&b.0)));
            for (index, _) in entries { writer.push_image(&archive_member(&mut archive, index, MAX_PAGE_BYTES)?)?; }
            writer.finish(metadata)
        }
        "jpg" | "jpeg" | "png" | "webp" | "gif" => {
            writer.push_image(&read_limited(File::open(path)?, MAX_PAGE_BYTES)?)?; writer.finish(BookMetadata::default())
        }
        "doc" => bail!("Legacy .doc is unsupported. Export it to PDF or DOCX first."),
        _ => bail!("Unsupported format. Import ZIP, CBZ, PDF, EPUB, DOCX, TXT, or an image folder."),
    }
}

#[cfg(test)]
mod classification_metadata_tests {
    use super::*;
    #[test]
    fn xml_reads_leaf_text_once_including_numbers_and_nested_text() {
        let m = comicinfo_metadata(r#"<ComicInfo><Series>Paper Kingdom</Series><Number>12</Number><Volume>3</Volume><Writer>Writer Name</Writer><Summary>Hello <b>world</b></Summary><Manga>YesAndRightToLeft</Manga></ComicInfo>"#).unwrap();
        assert_eq!(m.series_hint, "Paper Kingdom");
        assert_eq!(m.author, "Writer Name");
        assert_eq!(m.chapter_hint, Some(12.0)); assert_eq!(m.volume_hint, Some(3.0));
        assert_eq!(m.description, "Hello world"); assert_eq!(m.manga_indicator, "YesAndRightToLeft");
    }
    #[test]
    fn preserves_origin_format_aliases_and_edition_language_separately() {
        let m = comicinfo_metadata(r#"<ComicInfo><Series>Paper Kingdom</Series><LocalizedSeries>Other title</LocalizedSeries><Tags>Manhwa, Webtoon</Tags><OriginalLanguage>ko</OriginalLanguage><LanguageISO>en</LanguageISO><Format>Long Strip</Format><CountryOfOrigin>KR</CountryOfOrigin><Web>https://myanimelist.net/manga/123</Web></ComicInfo>"#).unwrap();
        assert_eq!(m.original_language, "ko"); assert_eq!(m.language, "en");
        assert_eq!(m.publication_format, "Long Strip"); assert_eq!(m.alternate_titles, vec!["Other title"]);
        assert_eq!(m.medium, Medium::Manhwa); assert_eq!(m.metadata_revision, 2);
    }
    #[test]
    fn edition_language_alone_does_not_invent_an_origin() {
        let m = comicinfo_metadata("<ComicInfo><LanguageISO>ko</LanguageISO></ComicInfo>").unwrap();
        assert_eq!(m.medium, Medium::Unknown);
    }
    #[test]
    fn utf16_metadata_is_decoded_before_xml_parsing() {
        let text = "<ComicInfo><Series>Paper Kingdom</Series><Number>3</Number></ComicInfo>";
        let mut bytes = vec![0xff, 0xfe];
        for word in text.encode_utf16() { bytes.extend_from_slice(&word.to_le_bytes()); }
        let parsed = comicinfo_metadata(&metadata_xml(&bytes).unwrap()).unwrap();
        assert_eq!(parsed.chapter_hint, Some(3.0)); assert_eq!(parsed.series_hint, "Paper Kingdom");
    }
    #[test]
    fn epub_paths_decode_percent_escapes_and_parent_segments() {
        assert_eq!(normalize_zip_path("OEBPS/content.opf", "Text/Chapter%201.xhtml#start").as_deref(), Some("OEBPS/Text/Chapter 1.xhtml"));
        assert_eq!(normalize_zip_path("OPS/package/content.opf", "../Text/chapter.xhtml").as_deref(), Some("OPS/Text/chapter.xhtml"));
    }
    #[test]
    fn tolerant_epub_html_handles_named_entities_and_broken_xhtml() {
        let html = "<html><head><title>First &amp; Last</title></head><body><h1>Opening</h1><p>Hello&nbsp;reader &mdash; welcome.</p><p>Broken <b>tag</p></body></html>";
        let chapter = chapter_from_markup(html, 1).expect("chapter should be recovered");
        assert!(chapter.text.contains("Hello reader"));
        assert!(chapter.text.contains("Broken tag"));
        assert!(chapter.word_count >= 5);
    }
}
