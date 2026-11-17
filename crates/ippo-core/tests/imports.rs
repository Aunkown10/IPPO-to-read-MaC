use ippo_core::Store;
use std::{fs::{self, File}, io::{Cursor, Write}, path::Path};
use tempfile::tempdir;
use zip::{write::SimpleFileOptions, ZipWriter};
fn png(red: u8) -> Vec<u8> {
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 5, image::Rgb([red, 80, 100])));
    let mut out = Cursor::new(Vec::new()); image.write_to(&mut out, image::ImageFormat::Png).unwrap(); out.into_inner()
}
fn archive(path: &Path, entries: &[(&str, Vec<u8>)]) {
    let mut writer = ZipWriter::new(File::create(path).unwrap());
    for (name, data) in entries { writer.start_file(*name, SimpleFileOptions::default()).unwrap(); writer.write_all(data).unwrap(); }
    writer.finish().unwrap();
}
#[test] fn zip_pages_use_natural_order() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Test Series v01.cbz");
    archive(&source, &[("page10.png", png(10)), ("page2.png", png(2)), ("page1.png", png(1))]);
    let mut store = Store::open(dir.path().join("library")).unwrap(); let book = store.import_one(&source, false).unwrap();
    assert_eq!(book.pages.len(), 3);
    assert_eq!(store.read_page(&book.id, 0).unwrap(), png(1)); assert_eq!(store.read_page(&book.id, 1).unwrap(), png(2)); assert_eq!(store.read_page(&book.id, 2).unwrap(), png(10));
}
#[test] fn zip_traversal_paths_are_rejected_without_extracting_anything() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Bad.cbz");
    archive(&source, &[("../escape.png", png(1))]);
    let mut store = Store::open(dir.path().join("library")).unwrap();
    assert!(store.import_one(&source, false).is_err()); assert!(store.list_books(false).unwrap().is_empty()); assert!(!dir.path().join("escape.png").exists());
}
#[test] fn no_supported_images_is_an_error_not_an_empty_comic() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Empty.zip");
    archive(&source, &[("readme.txt", b"hello".to_vec())]);
    let mut store = Store::open(dir.path().join("library")).unwrap(); assert!(store.import_one(&source, false).is_err());
}
#[test] fn docx_uses_relationship_order_instead_of_image_filename_order() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Document Comic.docx");
    let xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><a:blip r:embed="second"/><a:blip r:embed="first"/></w:body></w:document>"#;
    let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="second" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/></Relationships>"#;
    archive(&source, &[("word/document.xml", xml.to_vec()), ("word/_rels/document.xml.rels", rels.to_vec()), ("word/media/image1.png", png(1)), ("word/media/image2.png", png(2))]);
    let mut store = Store::open(dir.path().join("library")).unwrap(); let book = store.import_one(&source, false).unwrap();
    assert_eq!(book.pages.len(), 2); assert_eq!(store.read_page(&book.id, 0).unwrap(), png(2)); assert_eq!(store.read_page(&book.id, 1).unwrap(), png(1));
}
#[test] fn image_folders_import_without_touching_originals() {
    let dir = tempdir().unwrap(); let folder = dir.path().join("Folder Comic Vol 1"); fs::create_dir(&folder).unwrap();
    fs::write(folder.join("10.png"), png(10)).unwrap(); fs::write(folder.join("2.PNG"), png(2)).unwrap();
    let mut store = Store::open(dir.path().join("library")).unwrap(); let book = store.import_one(&folder, false).unwrap();
    assert_eq!(book.pages.len(), 2); assert_eq!(store.read_page(&book.id, 0).unwrap(), png(2));
    store.remove_book(&book.id).unwrap(); assert!(folder.join("2.PNG").exists());
}
#[test] fn legacy_doc_is_explicitly_unsupported() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Old Comic.doc"); fs::write(&source, b"not really a document").unwrap();
    let mut store = Store::open(dir.path().join("library")).unwrap();
    let error = store.import_one(&source, false).unwrap_err().to_string(); assert!(error.contains("Export it to PDF"));
}
#[test] fn modified_private_page_fails_authentication() {
    let dir = tempdir().unwrap(); let source = dir.path().join("Comic.png"); fs::write(&source, png(1)).unwrap();
    let root = dir.path().join("library"); let mut store = Store::open(&root).unwrap(); store.create_vault("a sufficiently long passphrase".into()).unwrap();
    let book = store.import_one(&source, true).unwrap();
    let page = root.join("books").join(&book.id).join("page-00000.bin"); let mut data = fs::read(&page).unwrap(); let n = data.len(); data[n - 1] ^= 1; fs::write(&page, data).unwrap();
    assert!(store.read_page(&book.id, 0).is_err());
}

#[test]
fn watched_folder_adopts_manually_imported_chapters_without_duplicates() {
    let dir = tempdir().unwrap();
    let comics = dir.path().join("Comics");
    fs::create_dir(&comics).unwrap();
    let ch1 = comics.join("Hajime no Ippo ch.1.cbz");
    let ch2 = comics.join("Hajime no Ippo ch.2.cbz");
    let ch3 = comics.join("Hajime no Ippo ch.3.cbz");
    archive(&ch1, &[("001.png", png(1))]);
    archive(&ch2, &[("001.png", png(2))]);
    archive(&ch3, &[("001.png", png(3))]);

    let mut store = Store::open(dir.path().join("library")).unwrap();
    let first = store.import_one(&ch1, false).unwrap();
    let second = store.import_one(&ch2, false).unwrap();
    assert_eq!(store.list_books(false).unwrap().len(), 2);

    store.add_watched_folder(comics).unwrap();
    let sync = store.sync_watched_folders().unwrap();
    assert_eq!(sync.matched_existing, 2);
    assert_eq!(sync.imported.len(), 1);

    let books = store.list_books(false).unwrap();
    assert_eq!(books.len(), 3, "watching the source folder must not duplicate manually imported chapters");
    assert!(books.iter().any(|book| book.id == first.id));
    assert!(books.iter().any(|book| book.id == second.id));
    assert_eq!(books.iter().filter(|book| book.chapter == Some(1.0)).count(), 1);
    assert_eq!(books.iter().filter(|book| book.chapter == Some(2.0)).count(), 1);
    assert_eq!(books.iter().filter(|book| book.chapter == Some(3.0)).count(), 1);

    let second_sync = store.sync_watched_folders().unwrap();
    assert_eq!(second_sync.matched_existing, 0);
    assert!(second_sync.imported.is_empty());
    assert_eq!(store.list_books(false).unwrap().len(), 3);
}
