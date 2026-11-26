//! Text out of documents: xberg first, pandoc as the fallback. The result is Markdown.

use std::path::Path;
use tokio::process::Command;

/// MIME type by extension: browsers often send `application/octet-stream` for documents.
pub fn mime_for(file_name: &str, given: &str) -> String {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let known = match ext.as_str() {
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "rtf" => "application/rtf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "pdf" => "application/pdf",
        _ => return given.to_owned(),
    };
    known.to_owned()
}

#[derive(Debug, PartialEq)]
pub struct Extracted {
    pub markdown: String,
    pub method: &'static str,
}

/// Extracts Markdown; Err carries a log message when neither xberg nor pandoc gave text.
pub async fn extract(bytes: Vec<u8>, file_name: &str, mime: &str) -> Result<Extracted, String> {
    let xberg_error = match with_xberg(bytes.clone(), file_name, mime).await {
        Ok(text) if !text.trim().is_empty() => {
            return Ok(Extracted {
                markdown: text,
                method: "xberg",
            });
        }
        Ok(_) => "xberg returned empty text".to_owned(),
        Err(e) => format!("xberg: {e}"),
    };
    match with_pandoc(&bytes, file_name).await {
        Ok(text) if !text.trim().is_empty() => Ok(Extracted {
            markdown: text,
            method: "pandoc",
        }),
        Ok(_) => Err(format!("{xberg_error}; pandoc returned empty text")),
        Err(e) => Err(format!("{xberg_error}; pandoc: {e}")),
    }
}

/// xberg alone, as Markdown; PDFs use it for their text layer.
pub async fn with_xberg(bytes: Vec<u8>, file_name: &str, mime: &str) -> Result<String, String> {
    let config: xberg::ExtractionConfig =
        serde_json::from_value(serde_json::json!({ "output_format": "markdown" }))
            .map_err(|e| e.to_string())?;
    let input = xberg::ExtractInput::from_bytes(bytes, mime.to_owned(), Some(file_name.to_owned()));
    let output = xberg::extract(input, &config)
        .await
        .map_err(|e| e.to_string())?;
    Ok(output
        .results
        .into_iter()
        .map(|r| r.content)
        .collect::<Vec<_>>()
        .join("\n\n"))
}

async fn with_pandoc(bytes: &[u8], file_name: &str) -> Result<String, String> {
    // pandoc picks the reader by extension, so keep it on the temporary file.
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt");
    let file = tempfile::Builder::new()
        .suffix(&format!(".{ext}"))
        .tempfile()
        .map_err(|e| e.to_string())?;
    tokio::fs::write(file.path(), bytes)
        .await
        .map_err(|e| e.to_string())?;
    let out = Command::new("pandoc")
        .arg(file.path())
        .args(["--to", "gfm", "--wrap", "none"])
        .output()
        .await
        .map_err(|e| format!("cannot run pandoc (is it in PATH?): {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
