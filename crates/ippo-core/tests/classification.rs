use ippo_core::{ClassificationDecision, Medium, Progress, ReadingMode, Store};
use std::{fs::{self, File}, io::{Cursor, Write}, path::Path};
use tempfile::tempdir;
use zip::{write::SimpleFileOptions, ZipWriter};
fn archive(path: &Path, xml: Option<&str>) {
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 6, image::Rgb([30, 100, 60])));
    let mut bytes = Cursor::new(Vec::new()); image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    let mut writer = ZipWriter::new(File::create(path).unwrap());
    writer.start_file("1.png", SimpleFileOptions::default()).unwrap(); writer.write_all(bytes.get_ref()).unwrap();
    if let Some(xml) = xml { writer.start_file("ComicInfo.xml", SimpleFileOptions::default()).unwrap(); writer.write_all(xml.as_bytes()).unwrap(); }
    writer.finish().unwrap();
}
fn decision(medium: Medium, locked: bool) -> ClassificationDecision {
    ClassificationDecision { medium, layout: "longstrip".into(), status: "confirmed".into(),
        source: "fixture".into(), locked, version: 2, ..Default::default() }
}
#[test]
fn classification_preserves_ids_bookmarks_reading_time_and_files_across_restart() {
    let dir = tempdir().unwrap(); let root = dir.path().join("data"); let a = dir.path().join("Paper Kingdom ch.1.cbz"); let b = dir.path().join("Paper Kingdom ch.2.cbz");
    archive(&a, None); archive(&b, None);
    let mut store = Store::open(&root).unwrap(); let one = store.import_one(&a, false).unwrap(); let two = store.import_one(&b, false).unwrap();
    let progress = Progress { mode: ReadingMode::Scroll, offset: 0.5, ..Default::default() };
    store.save_progress(&one.id, progress.clone()).unwrap(); store.add_reading_time(&one.id, 60).unwrap();
    let page = store.read_page(&one.id, 0).unwrap(); let cover = store.read_cover(&one.id).unwrap();
    assert_eq!(store.apply_classification(&one.id, decision(Medium::Manhwa, true)).unwrap(), 2);
    drop(store); let mut store = Store::open(root).unwrap(); let books = store.list_books(false).unwrap();
    assert_eq!(books.len(), 2); assert!(books.iter().all(|b| b.metadata.medium == Medium::Manhwa));
    let book = books.iter().find(|b| b.id == one.id).unwrap(); assert_eq!(book.progress, progress); assert_eq!(book.reading_seconds, 60);
    assert!(books.iter().any(|b| b.id == two.id)); assert_eq!(store.read_page(&one.id, 0).unwrap(), page); assert_eq!(store.read_cover(&one.id).unwrap(), cover);
    assert!(a.exists()); assert!(b.exists());
}
#[test]
fn pinned_choices_survive_rechecks_and_new_chapters_inherit_them() {
    let dir = tempdir().unwrap(); let root = dir.path().join("data"); let a = dir.path().join("Paper Kingdom ch.1.cbz"); let b = dir.path().join("Paper Kingdom ch.2.cbz");
    archive(&a, None); archive(&b, None); let mut store = Store::open(root).unwrap(); let one = store.import_one(&a, false).unwrap();
    store.apply_classification(&one.id, decision(Medium::Manhwa, true)).unwrap();
    assert_eq!(store.apply_classification(&one.id, decision(Medium::Manga, false)).unwrap(), 0);
    let two = store.import_one(&b, false).unwrap(); assert_eq!(two.metadata.medium, Medium::Manhwa); assert!(two.metadata.classification.unwrap().locked);
}
#[test]
fn same_named_private_and_normal_shelves_remain_separate() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Paper Kingdom ch.1.cbz"); archive(&source, None);
    let mut store = Store::open(dir.path().join("data")).unwrap(); store.create_vault("long private test password".into()).unwrap();
    let public = store.import_one(&source, false).unwrap(); let private = store.import_one(&source, true).unwrap();
    store.apply_classification(&public.id, decision(Medium::Manhwa, true)).unwrap();
    assert_eq!(store.list_books(true).unwrap()[0].metadata.medium, Medium::Unknown);
    store.lock_vault(); assert!(store.classification_books(&private.id).is_err());
    assert!(store.apply_classification(&private.id, decision(Medium::Manhua, true)).is_err());
}
#[test]
fn rereading_metadata_does_not_import_again_or_change_chapter_numbers() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Paper Kingdom ch.1.cbz"); archive(&source, None);
    let mut store = Store::open(dir.path().join("data")).unwrap(); let original = store.import_one(&source, false).unwrap();
    archive(&source, Some("<ComicInfo><Series>Paper Kingdom</Series><Number>999</Number><Tags>Manhwa</Tags><Format>Long Strip</Format></ComicInfo>"));
    let books = store.read_classification_metadata(&original.id, &source).unwrap(); assert_eq!(books.len(), 1);
    assert_eq!(books[0].id, original.id); assert_eq!(books[0].chapter, original.chapter); assert_eq!(books[0].metadata.tags, vec!["Manhwa"]);
    fs::remove_file(&source).unwrap(); assert!(store.read_page(&original.id, 0).is_ok());
}
#[test]
fn malformed_xml_is_reported_without_discarding_readable_pages() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Paper Kingdom ch.1.cbz"); archive(&source, Some("<ComicInfo><Series>Broken"));
    let mut store = Store::open(dir.path().join("data")).unwrap(); let book = store.import_one(&source, false).unwrap();
    assert_eq!(book.pages.len(), 1); assert!(!book.metadata.metadata_warnings.is_empty()); assert_eq!(book.metadata.medium, Medium::Unknown);
}
