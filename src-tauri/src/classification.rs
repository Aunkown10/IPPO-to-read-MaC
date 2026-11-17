//! Bounded, read-only catalog transport. Origin/matching logic is tested in TypeScript.
//! All requests use fixed API hosts. Embedded publisher/download links are never fetched.
use crate::{work, ApiResult, Backend, DialogGate, DialogGuard};
use ippo_core::{Book, ClassificationDecision};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn classification_books(state: State<'_, Backend>, id: String) -> ApiResult<Vec<Book>> {
    work(state.inner().clone(), move |s| s.classification_books(&id)).await
}
#[tauri::command]
pub async fn apply_classification(state: State<'_, Backend>, id: String, decision: ClassificationDecision) -> ApiResult<usize> {
    work(state.inner().clone(), move |s| s.apply_classification(&id, decision)).await
}
#[tauri::command]
pub async fn reread_comic_metadata(app: AppHandle, state: State<'_, Backend>, gate: State<'_, DialogGate>, id: String) -> ApiResult<Option<Vec<Book>>> {
    let target = id.clone();
    let books = work(state.inner().clone(), move |s| s.classification_books(&target)).await?;
    if books.iter().any(|b| b.is_private) { work(state.inner().clone(), |s| s.touch_vault()).await?; }
    gate.inner().0.compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
        .map_err(|_| "Another file picker is open".to_string())?;
    let guard = DialogGuard(gate.inner().0.clone());
    let selected = tauri::async_runtime::spawn_blocking(move || app.dialog().file()
        .set_title("Choose an original chapter from THIS series to read its ComicInfo.xml (no import)")
        .add_filter("Comic archives", &["cbz", "zip"]).blocking_pick_file()).await.map_err(|e| e.to_string())?;
    drop(guard);
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "Choose a local archive".to_string())?;
    work(state.inner().clone(), move |s| s.read_classification_metadata(&id, &path).map(Some)).await
}

fn reference_id(urls: &str, host: &str, segment: &str) -> Option<String> {
    for raw in urls.split_whitespace() {
        let Ok(url) = reqwest::Url::parse(raw) else { continue; };
        if url.scheme() != "https" && url.scheme() != "http" { continue; }
        let actual = url.host_str().unwrap_or("").trim_start_matches("www.");
        if actual != host { continue; }
        let parts: Vec<_> = url.path_segments().into_iter().flatten().collect();
        if parts.first().copied() != Some(segment) { continue; }
        let Some(id) = parts.get(1) else { continue; };
        let valid = if host == "mangadex.org" {
            id.len() == 36 && id.bytes().enumerate().all(|(i, b)| if [8,13,18,23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() })
        } else { !id.is_empty() && id.len() <= 10 && id.bytes().all(|b| b.is_ascii_digit()) };
        if valid { return Some(id.to_string()); }
    }
    None
}
async fn fetch_json(request: reqwest::RequestBuilder, provider: &str, direct_id: Option<&str>) -> Value {
    let result: Result<Value, String> = async {
        let mut response = request.send().await.map_err(|e| format!("Connection failed or timed out: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            let hint = if status.as_u16() == 429 { " (rate limited; try again later)" } else { "" };
            return Err(format!("HTTP {status}{hint}"));
        }
        const LIMIT: usize = 2 * 1024 * 1024;
        if response.content_length().is_some_and(|n| n > LIMIT as u64) { return Err("Metadata response exceeds 2 MiB".into()); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > LIMIT { return Err("Metadata response exceeds 2 MiB".into()); }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice::<Value>(&bytes).map_err(|_| "Response is not valid JSON (possibly a blocked API or changed endpoint)".into())
    }.await;
    match result {
        Ok(data) => json!({"provider": provider, "data": data, "directId": direct_id}),
        Err(error) => json!({"provider": provider, "error": error}),
    }
}

#[tauri::command]
pub async fn classification_sources(state: State<'_, Backend>, id: String, query: String) -> ApiResult<Value> {
    // Gate by stored privacy status BEFORE sending even a search query to the network.
    let books = work(state.inner().clone(), move |s| s.classification_books(&id)).await?;
    if books.is_empty() || books.iter().any(|b| b.is_private) { return Err("Private titles never use online classification".into()); }
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 { return Err("Use a series title of 1-200 characters".into()); }
    let refs = books.iter().map(|b| b.metadata.source_url.as_str()).collect::<Vec<_>>().join(" ");
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(9))
        .connect_timeout(std::time::Duration::from_secs(5)).redirect(reqwest::redirect::Policy::none())
        .user_agent("Ippo-to-Read/0.3.2 (local library metadata; no comic pages)").build().map_err(|e| e.to_string())?;
    let mut responses = Vec::new();
    let mal = reference_id(&refs, "myanimelist.net", "manga");
    let request = if let Some(id) = &mal { client.get(format!("https://api.jikan.moe/v4/manga/{id}")) }
        else { client.get("https://api.jikan.moe/v4/manga").query(&[("q", query), ("limit", "20")]) };
    responses.push(fetch_json(request, "MyAnimeList / Jikan", mal.as_deref()).await);
    let md = reference_id(&refs, "mangadex.org", "title");
    let request = if let Some(id) = &md { client.get(format!("https://api.mangadex.org/manga/{id}")).query(&[("includes[]", "author")]) }
        else { client.get("https://api.mangadex.org/manga").query(&[("title", query), ("limit", "20"), ("includes[]", "author")]) };
    responses.push(fetch_json(request, "MangaDex", md.as_deref()).await);
    let al = reference_id(&refs, "anilist.co", "manga");
    let fields = "id idMal title { romaji english native } synonyms countryOfOrigin format tags { name } staff(perPage: 5) { nodes { name { full } } }";
    let body = if let Some(id) = al.as_ref().and_then(|id| id.parse::<i32>().ok()) {
        json!({"query": format!("query($id:Int) {{ Media(id:$id, type:MANGA) {{ {fields} }} }}"), "variables": {"id": id}})
    } else {
        json!({"query": format!("query($search:String) {{ Page(perPage:20) {{ media(search:$search, type:MANGA, format_in:[MANGA,ONE_SHOT]) {{ {fields} }} }} }}"), "variables": {"search": query}})
    };
    responses.push(fetch_json(client.post("https://graphql.anilist.co").json(&body), "AniList", al.as_deref()).await);
    Ok(json!({"responses": responses, "warnings": []}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn refs_are_exact_hosts_and_bounded_ids() {
        assert_eq!(reference_id("https://myanimelist.net/manga/123/test", "myanimelist.net", "manga"), Some("123".into()));
        assert_eq!(reference_id("https://myanimelist.net.evil.test/manga/123", "myanimelist.net", "manga"), None);
        assert_eq!(reference_id("file:///manga/123", "myanimelist.net", "manga"), None);
        assert_eq!(reference_id("https://myanimelist.net/manga/../../other", "myanimelist.net", "manga"), None);
    }
}
