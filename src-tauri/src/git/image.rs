//! Before/after contents of image files, for the diff viewer's image preview.
//! Each side is returned as a `data:` URL so the webview can show it directly.

use std::path::{Component, Path};

use serde::Serialize;

use super::model::DiffRequest;
use super::runner::Git;
use crate::error::AppResult;

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageSide {
    pub data_url: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImagePair {
    pub before: Option<ImageSide>,
    pub after: Option<ImageSide>,
    /// a side exists but is larger than the preview limit
    pub too_large: bool,
}

pub fn mime_for(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn is_safe_relative(path: &str) -> bool {
    let p = Path::new(path);
    !path.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)))
}

fn blob(git: &Git, spec: &str) -> Option<Vec<u8>> {
    git.run(&["cat-file", "blob", spec]).ok()
}

fn worktree(git: &Git, path: &str) -> Option<Vec<u8>> {
    if !is_safe_relative(path) {
        return None;
    }
    std::fs::read(git.cwd().join(path)).ok()
}

pub fn get_file_image(git: &Git, req: &DiffRequest) -> AppResult<ImagePair> {
    let Some(mime) = mime_for(&req.path) else {
        return Ok(ImagePair::default());
    };
    let old = req.old_path.as_deref().unwrap_or(&req.path);
    let (before, after) = match (req.source.as_str(), req.untracked) {
        (_, true) => (None, worktree(git, &req.path)),
        ("staged", _) => (blob(git, &format!("HEAD:{old}")), blob(git, &format!(":{}", req.path))),
        ("commit", _) => {
            let commit = req.commit.as_deref().unwrap_or("HEAD");
            let parent = req.parent.clone().unwrap_or_else(|| format!("{commit}^"));
            (blob(git, &format!("{parent}:{old}")), blob(git, &format!("{commit}:{}", req.path)))
        }
        _ => (blob(git, &format!(":{old}")), worktree(git, &req.path)),
    };
    let mut too_large = false;
    let mut side = |data: Option<Vec<u8>>| {
        let data = data?;
        if data.len() > MAX_IMAGE_BYTES {
            too_large = true;
            return None;
        }
        Some(ImageSide { data_url: format!("data:{mime};base64,{}", base64(&data)), bytes: data.len() })
    };
    let before = side(before);
    let after = side(after);
    Ok(ImagePair { before, after, too_large })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_base64() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    }

    #[test]
    fn knows_image_types() {
        assert_eq!(mime_for("a/b/Logo.PNG"), Some("image/png"));
        assert_eq!(mime_for("x.webp"), Some("image/webp"));
        assert_eq!(mime_for("x.txt"), None);
        assert_eq!(mime_for("Makefile"), None);
    }

    #[test]
    fn rejects_paths_outside_the_repo() {
        assert!(is_safe_relative("assets/a.png"));
        assert!(!is_safe_relative("../secret.png"));
        assert!(!is_safe_relative("/etc/a.png"));
        assert!(!is_safe_relative("a/../../b.png"));
    }
}
