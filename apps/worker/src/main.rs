//! AiRepetitor extraction worker: claim a job, extract its text, report back (ADR 0003).

mod api;
mod config;
mod document;
mod log;
mod pdf;
mod photo;
mod vision;

use api::{Api, ApiError, Job, Outcome};
use config::Config;
use document::Extracted;
use log::Log;
use pdfium_render::prelude::Pdfium;
use serde_json::json;
use std::{sync::Arc, time::Duration};
use vision::{Reading, Usage, Vision};

const IDLE_PAUSE: Duration = Duration::from_secs(10);
/// The API was deployed with another protocol: do not take jobs, look again later.
const UPGRADE_PAUSE: Duration = Duration::from_secs(10 * 60);

/// Learner-facing reasons of a failed Source.
const PHOTO_UNREADABLE: &str = "не удалось прочитать фото: текст не разобрать";
const PHOTO_FORMAT: &str = "формат фото не читается";
const VISION_UNAVAILABLE: &str = "временная ошибка распознавания";
const PDF_UNREADABLE: &str = "не удалось прочитать PDF";

/// Why a Source failed: a code for the API, a reason for the Learner, details for the log.
struct Failure {
    code: &'static str,
    reason: String,
    detail: String,
}

impl Failure {
    fn new(code: &'static str, reason: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code,
            reason: reason.into(),
            detail: detail.into(),
        }
    }
}

struct Worker {
    api: Api,
    http: reqwest::Client,
    log: Log,
    vision: Option<Vision>,
    vision_model: String,
    pdfium: Option<Arc<Pdfium>>,
}

#[tokio::main]
async fn main() {
    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let log = Log::open(&config.log_dir);
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .expect("HTTP client");
    let pdfium = match pdf::load_pdfium(&config.pdfium_library) {
        Ok(p) => Some(p),
        Err(e) => {
            log.error(
                "pdfium is not available; not taking PDFs (run apps/worker/scripts/install-pdfium.sh)",
                json!({ "error": e }),
            );
            None
        }
    };
    let kinds = config.kinds(pdfium.is_some());
    let worker = Worker {
        api: Api::new(http.clone(), &config.api_url, &config.worker_token),
        vision: config.deepinfra_api_key.as_deref().map(|key| {
            Vision::new(
                http.clone(),
                &config.model_base_url,
                key,
                &config.vision_model,
            )
        }),
        vision_model: config.vision_model.clone(),
        http,
        log,
        pdfium,
    };
    worker.log.info(
        "worker started",
        json!({
            "api": config.api_url,
            "kinds": kinds,
            "modelKey": config.deepinfra_api_key.is_some(),
            "visionModel": config.vision_model,
            "asrModel": config.asr_model,
        }),
    );

    loop {
        match worker.api.claim(&kinds).await {
            Ok(Some(job)) => worker.run_job(&job).await,
            Ok(None) => tokio::time::sleep(IDLE_PAUSE).await,
            Err(ApiError::Upgrade(m)) => {
                worker.log.error(
                    "API protocol mismatch; not taking jobs",
                    json!({ "detail": m }),
                );
                tokio::time::sleep(UPGRADE_PAUSE).await;
            }
            Err(e) => {
                worker
                    .log
                    .error("claim failed", json!({ "error": e.to_string() }));
                tokio::time::sleep(IDLE_PAUSE).await;
            }
        }
    }
}

impl Worker {
    /// One job at a time. Network trouble leaves the job alone: its lease expires and it is claimed again.
    async fn run_job(&self, job: &Job) {
        let ids = json!({
            "job": job.job_id,
            "source": job.source_id,
            "attempt": job.attempt,
            "kind": job.kind,
            "file": job.file_name,
            "leaseExpiresAt": job.lease_expires_at,
        });
        self.log.info("job claimed", ids.clone());

        let bytes = match download(&self.http, &job.read_url).await {
            Ok(b) => b,
            Err(e) => {
                return self
                    .log
                    .error("download failed", json!({ "ids": ids, "error": e }));
            }
        };

        let mut usage = Usage {
            model: self.vision_model.clone(),
            input_tokens: 0,
            output_tokens: 0,
        };
        let extracted = match job.kind.as_str() {
            "document" => {
                let mime = document::mime_for(&job.file_name, &job.mime_type);
                document::extract(bytes, &job.file_name, &mime)
                    .await
                    .map_err(|e| {
                        Failure::new("unreadable_document", "не удалось прочитать документ", e)
                    })
            }
            "image" => self.read_photo(job, bytes, &mut usage).await,
            "pdf" => self.read_pdf(job, bytes, &mut usage).await,
            other => Err(Failure::new(
                "unsupported_kind",
                format!("этот worker пока не умеет обрабатывать файлы вида «{other}»"),
                "",
            )),
        };

        let outcome = match extracted {
            Ok(text) => {
                if let Err(e) =
                    upload(&self.http, &job.write_text, text.markdown.into_bytes()).await
                {
                    return self
                        .log
                        .error("text upload failed", json!({ "ids": ids, "error": e }));
                }
                Outcome::Success {
                    method: text.method.to_owned(),
                    audio_saved: None,
                }
            }
            Err(failure) => {
                self.log.error(
                    "extraction failed",
                    json!({ "ids": ids, "code": failure.code, "error": failure.detail }),
                );
                Outcome::Failure {
                    code: failure.code.to_owned(),
                    reason: failure.reason,
                }
            }
        };

        let spent = if usage.input_tokens + usage.output_tokens > 0 {
            vec![usage]
        } else {
            vec![]
        };
        match self.api.complete(job, &outcome, &spent).await {
            Ok(()) => self.log.info(
                "job completed",
                json!({ "ids": ids, "outcome": outcome_name(&outcome), "usage": spent }),
            ),
            Err(e) => self.log.error(
                "complete failed",
                json!({ "ids": ids, "error": e.to_string() }),
            ),
        }
    }

    /// The vision model and the Playbook instruction, which every picture needs.
    fn vision_for<'a>(&'a self, job: &'a Job) -> Result<(&'a Vision, &'a str), Failure> {
        let vision = self.vision.as_ref().ok_or_else(|| {
            Failure::new(
                "no_model_key",
                VISION_UNAVAILABLE,
                "DEEPINFRA_API_KEY is not set",
            )
        })?;
        let prompt = job.vision_prompt.as_deref().ok_or_else(|| {
            Failure::new(
                "no_vision_prompt",
                VISION_UNAVAILABLE,
                "the job has no visionPrompt",
            )
        })?;
        Ok((vision, prompt))
    }

    async fn read_photo(
        &self,
        job: &Job,
        bytes: Vec<u8>,
        usage: &mut Usage,
    ) -> Result<Extracted, Failure> {
        let (vision, prompt) = self.vision_for(job)?;
        let bytes = if photo::is_heic(&job.file_name, &job.mime_type) {
            photo::heic_to_jpeg(&bytes)
                .await
                .map_err(|e| Failure::new("photo_format", PHOTO_FORMAT, e))?
        } else {
            bytes
        };
        let jpeg = tokio::task::spawn_blocking(move || photo::prepare(&bytes))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r)
            .map_err(|e| Failure::new("photo_format", PHOTO_FORMAT, e))?;
        let markdown = read_picture(vision, prompt, &jpeg, usage, "unreadable_photo", || {
            PHOTO_UNREADABLE.to_owned()
        })
        .await?;
        Ok(Extracted {
            markdown,
            method: "vision",
        })
    }

    /// The text layer when it has enough text per page; otherwise every page through the vision model.
    async fn read_pdf(
        &self,
        job: &Job,
        bytes: Vec<u8>,
        usage: &mut Usage,
    ) -> Result<Extracted, Failure> {
        let layer = document::with_xberg(bytes.clone(), &job.file_name, "application/pdf").await;
        let pages = pdf::page_count(&bytes);
        let why_scan = match (&layer, pages) {
            (Ok(text), Some(n)) if !pdf::looks_scanned(text, n) => {
                return Ok(Extracted {
                    markdown: text.clone(),
                    method: "xberg",
                });
            }
            (Ok(_), Some(n)) => format!("text layer under the threshold for {n} pages"),
            (Ok(_), None) => "xberg cannot count pages".to_owned(),
            (Err(e), _) => format!("xberg: {e}"),
        };
        self.log.info(
            "PDF goes to the vision model",
            json!({ "source": job.source_id, "why": why_scan }),
        );

        let (vision, prompt) = self.vision_for(job)?;
        let pdfium = self
            .pdfium
            .clone()
            .ok_or_else(|| Failure::new("no_pdfium", VISION_UNAVAILABLE, "pdfium is not loaded"))?;
        let mut rendered = pdf::render_pages(pdfium, bytes);
        let mut parts = Vec::new();
        while let Some(event) = rendered.recv().await {
            let number = parts.len() + 1;
            let page_failed = || format!("не удалось прочитать страницу {number}");
            let jpeg = match event {
                pdf::Rendered::Unopenable(e) => {
                    return Err(Failure::new("unreadable_pdf", PDF_UNREADABLE, e));
                }
                pdf::Rendered::Page(Ok(jpeg)) => jpeg,
                pdf::Rendered::Page(Err(e)) => {
                    return Err(Failure::new("unrenderable_page", page_failed(), e));
                }
            };
            let text =
                read_picture(vision, prompt, &jpeg, usage, "unreadable_page", page_failed).await?;
            parts.push(format!("<!-- страница {number} -->\n\n{text}"));
        }
        if parts.is_empty() {
            return Err(Failure::new(
                "unreadable_pdf",
                PDF_UNREADABLE,
                "the PDF has no pages",
            ));
        }
        Ok(Extracted {
            markdown: parts.join("\n\n"),
            method: "vision",
        })
    }
}

/// One picture through the vision model; no text becomes `unreadable_code` with the given reason.
async fn read_picture(
    vision: &Vision,
    prompt: &str,
    jpeg: &[u8],
    usage: &mut Usage,
    unreadable_code: &'static str,
    unreadable_reason: impl FnOnce() -> String,
) -> Result<String, Failure> {
    match vision.read(prompt, jpeg, usage).await {
        Ok(Reading::Text(text)) => Ok(text),
        Ok(Reading::Unreadable) => Err(Failure::new(
            unreadable_code,
            unreadable_reason(),
            "the model found no text",
        )),
        Err(e) => Err(Failure::new("vision_unavailable", VISION_UNAVAILABLE, e)),
    }
}

fn outcome_name(outcome: &Outcome) -> &'static str {
    match outcome {
        Outcome::Success { .. } => "success",
        Outcome::Failure { .. } => "failure",
    }
}

async fn download(http: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let res = http.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

async fn upload(
    http: &reqwest::Client,
    link: &api::WriteLink,
    body: Vec<u8>,
) -> Result<(), String> {
    let mut req = http.put(&link.url).body(body);
    for (name, value) in &link.headers {
        req = req.header(name, value);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", res.status()))
    }
}
