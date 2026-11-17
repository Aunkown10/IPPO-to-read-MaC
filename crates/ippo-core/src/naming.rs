use regex::Regex;
use std::sync::LazyLock;

static VOLUME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(?:volume|vol|v)\.?[\s._-]*(\d+(?:\.\d+)?)\b").unwrap());
static CHAPTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(?:\b(?:chapter|chap|ch|issue|c)\.?[\s._-]*|#\s*)(\d+(?:\.\d+)?)\b").unwrap());
static NUMBERED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:\s+-\s+|\s+)(0\d+(?:\.\d+)?)\s*$").unwrap());
static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[[^\]]*\]").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

#[derive(Debug, PartialEq)]
pub struct ParsedName { pub series: String, pub title: String, pub volume: Option<f64>, pub chapter: Option<f64> }

/// Deliberately conservative: keep meaningful title numbers such as "Area 88".
/// Unknown naming conventions can be corrected through the shelf editor.
pub fn parse_name(stem: &str) -> ParsedName {
    let clean = stem.replace('_', " ");
    let clean = TAGS.replace_all(&clean, " ").trim().to_string();
    let clean = if clean.is_empty() { stem.to_string() } else { clean };
    let v = VOLUME.captures(&clean);
    let c = CHAPTER.captures(&clean);
    let numbered = if v.is_none() && c.is_none() { NUMBERED.captures(&clean) } else { None };
    let volume = v.as_ref().and_then(|x| x[1].parse::<f64>().ok());
    let chapter = c.as_ref().or(numbered.as_ref()).and_then(|x| x[1].parse::<f64>().ok());
    let start = v.as_ref().and_then(|x| x.get(0)).into_iter()
        .chain(c.as_ref().and_then(|x| x.get(0)))
        .chain(numbered.as_ref().and_then(|x| x.get(0)))
        .map(|m| m.start()).min().unwrap_or(clean.len());
    let raw_series = clean[..start].trim_matches(|c: char| c.is_whitespace() || ".-:()".contains(c));
    let raw_series = if raw_series.is_empty() { clean.as_str() } else { raw_series };
    let series = SPACES.replace_all(&raw_series.replace('.', " "), " ").trim().to_string();
    let series = if series.is_empty() { "Untitled".into() } else { series };
    let title = match (volume, chapter) {
        (Some(v), Some(c)) => format!("Volume {v} - Chapter {c}"),
        (Some(v), None) => format!("Volume {v}"),
        (None, Some(c)) => format!("Chapter {c}"),
        _ => series.clone(),
    };
    ParsedName { series, title, volume, chapter }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn normalizes_series() {
        for n in ["Chainsaw Man Vol 01", "Chainsaw.Man.v02", "Chainsaw_Man_Volume_03"] {
            assert_eq!(parse_name(n).series, "Chainsaw Man");
        }
    }
    #[test] fn reads_decimal_chapters() {
        let n = parse_name("A Long Journey Chapter 10.5 [Digital]");
        assert_eq!(n.series, "A Long Journey"); assert_eq!(n.chapter, Some(10.5));
    }
    #[test] fn preserves_title_numbers() {
        assert_eq!(parse_name("20th Century Boys Vol 1").series, "20th Century Boys");
        assert_eq!(parse_name("Area 88").series, "Area 88");
        assert_eq!(parse_name("1984").series, "1984");
    }
    #[test] fn removes_scan_tags_and_parses_padded_number() {
        let n = parse_name("[Group] My Series 003");
        assert_eq!(n.series, "My Series"); assert_eq!(n.chapter, Some(3.0));
    }
    #[test] fn detects_volume_and_chapter() {
        let n = parse_name("Series v2 c10");
        assert_eq!(n.volume, Some(2.0)); assert_eq!(n.chapter, Some(10.0));
    }
    #[test] fn chapter_files_share_one_series() {
        let a = parse_name("hajime no ippo ch.1");
        let b = parse_name("hajime no ippo ch.2");
        assert_eq!(a.series, "hajime no ippo");
        assert_eq!(a.series, b.series);
        assert_eq!(a.chapter, Some(1.0));
        assert_eq!(b.chapter, Some(2.0));
    }
}
