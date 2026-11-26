//! PDF: the text layer through xberg; a scan is rendered page by page with pdfium for the vision model.

use crate::photo;
use pdfium_render::prelude::{PdfRenderConfig, Pdfium};
use std::{path::Path, sync::Arc};
use tokio::sync::mpsc;

/// Fewer non-space characters per page on average than this means a scan.
const MIN_CHARS_PER_PAGE: usize = 20;
/// Rendered pages waiting for the vision model; keeps memory flat on long scans.
const PAGES_AHEAD: usize = 2;

/// Binds the pdfium library the install script downloaded. Done once per process.
pub fn load_pdfium(library: &Path) -> Result<Arc<Pdfium>, String> {
    Pdfium::bind_to_library(library)
        .map(|bindings| Arc::new(Pdfium::new(bindings)))
        .map_err(|e| format!("{}: {e}", library.display()))
}

/// Pages of a PDF, None when the PDF cannot be opened.
pub fn page_count(bytes: &[u8]) -> Option<usize> {
    xberg::pdf_page_count(bytes, None).ok()
}

/// True when the text layer has too little text for the number of pages.
pub fn looks_scanned(text: &str, pages: usize) -> bool {
    let chars = text.chars().filter(|c| !c.is_whitespace()).count();
    chars < MIN_CHARS_PER_PAGE * pages.max(1)
}

/// What the render thread sends, in page order. Strings are log messages.
pub enum Rendered {
    /// pdfium could not open the file; nothing else follows.
    Unopenable(String),
    /// The next page as JPEG, or why it could not be rendered.
    Page(Result<Vec<u8>, String>),
}

/// Renders every page on its own thread, in order, at most `photo::MAX_SIDE` px on the long side.
/// The thread stops when the receiver is dropped.
pub fn render_pages(pdfium: Arc<Pdfium>, bytes: Vec<u8>) -> mpsc::Receiver<Rendered> {
    let (tx, rx) = mpsc::channel(PAGES_AHEAD);
    std::thread::spawn(move || {
        let document = match pdfium.load_pdf_from_byte_slice(&bytes, None) {
            Ok(d) => d,
            Err(e) => {
                let _ = tx.blocking_send(Rendered::Unopenable(e.to_string()));
                return;
            }
        };
        let side = i32::try_from(photo::MAX_SIDE).unwrap_or(i32::MAX);
        let config = PdfRenderConfig::new()
            .set_target_width(side)
            .set_maximum_height(side);
        for page in document.pages().iter() {
            let jpeg = page
                .render_with_config(&config)
                .and_then(|bitmap| bitmap.as_image())
                .map_err(|e| e.to_string())
                .and_then(photo::to_jpeg);
            if tx.blocking_send(Rendered::Page(jpeg)).is_err() {
                return;
            }
        }
    });
    rx
}
