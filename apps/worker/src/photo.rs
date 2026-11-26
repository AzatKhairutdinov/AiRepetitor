//! Pictures for the vision model: HEIC to JPEG, EXIF rotation, at most 2048 px on the long side.

use image::{DynamicImage, ImageDecoder, ImageReader, codecs::jpeg::JpegEncoder};
use std::{io::Cursor, path::Path};
use tokio::process::Command;

/// Long side of a picture sent to the vision model.
pub const MAX_SIDE: u32 = 2048;
const JPEG_QUALITY: u8 = 90;

/// True for HEIC and HEIF photos, which the `image` crate cannot decode.
pub fn is_heic(file_name: &str, mime: &str) -> bool {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    matches!(ext.as_str(), "heic" | "heif") || matches!(mime, "image/heic" | "image/heif")
}

/// HEIC to JPEG with `sips` (macOS) or `heif-convert` (libheif). Err carries a log message.
pub async fn heic_to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input = dir.path().join("photo.heic");
    let output = dir.path().join("photo.jpg");
    tokio::fs::write(&input, bytes)
        .await
        .map_err(|e| e.to_string())?;
    let converters: [(&str, Vec<&std::ffi::OsStr>); 2] = [
        (
            "sips",
            vec![
                "-s".as_ref(),
                "format".as_ref(),
                "jpeg".as_ref(),
                input.as_os_str(),
                "--out".as_ref(),
                output.as_os_str(),
            ],
        ),
        ("heif-convert", vec![input.as_os_str(), output.as_os_str()]),
    ];
    let mut errors = Vec::new();
    for (program, args) in converters {
        match Command::new(program).args(&args).output().await {
            Ok(out) if out.status.success() => {
                return tokio::fs::read(&output).await.map_err(|e| e.to_string());
            }
            Ok(out) => errors.push(format!(
                "{program}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )),
            Err(e) => errors.push(format!("{program}: {e}")),
        }
    }
    Err(errors.join("; "))
}

/// Decodes a JPEG, PNG or WebP, turns it upright by EXIF and re-encodes it for the model.
pub fn prepare(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut picture = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    picture.apply_orientation(orientation);
    to_jpeg(picture)
}

/// Shrinks to `MAX_SIDE` when larger and encodes as JPEG.
pub fn to_jpeg(picture: DynamicImage) -> Result<Vec<u8>, String> {
    let picture = if picture.width().max(picture.height()) > MAX_SIDE {
        picture.resize(MAX_SIDE, MAX_SIDE, image::imageops::FilterType::Lanczos3)
    } else {
        picture
    };
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode_image(&picture.into_rgb8())
        .map_err(|e| e.to_string())?;
    Ok(out)
}
