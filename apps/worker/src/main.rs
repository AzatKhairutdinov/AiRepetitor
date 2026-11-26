//! AiRepetitor extraction worker: claim a job, extract its text, report back (ADR 0003).

mod api;
mod config;
mod document;
mod log;

use api::{Api, ApiError, Job, Outcome};
use config::Config;
use log::Log;
use serde_json::json;
use std::time::Duration;

const IDLE_PAUSE: Duration = Duration::from_secs(10);
/// The API was deployed with another protocol: do not take jobs, look again later.
const UPGRADE_PAUSE: Duration = Duration::from_secs(10 * 60);

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
    let api = Api::new(http.clone(), &config.api_url, &config.worker_token);
    log.info(
        "worker started",
        json!({
            "api": config.api_url,
            "kinds": config.kinds(),
            "modelKey": config.deepinfra_api_key.is_some(),
            "visionModel": config.vision_model,
            "asrModel": config.asr_model,
        }),
    );

    loop {
        match api.claim(&config.kinds()).await {
            Ok(Some(job)) => run_job(&api, &http, &log, &job).await,
            Ok(None) => tokio::time::sleep(IDLE_PAUSE).await,
            Err(ApiError::Upgrade(m)) => {
                log.error(
                    "API protocol mismatch; not taking jobs",
                    json!({ "detail": m }),
                );
                tokio::time::sleep(UPGRADE_PAUSE).await;
            }
            Err(e) => {
                log.error("claim failed", json!({ "error": e.to_string() }));
                tokio::time::sleep(IDLE_PAUSE).await;
            }
        }
    }
}

/// One job at a time. Network trouble leaves the job alone: its lease expires and it is claimed again.
async fn run_job(api: &Api, http: &reqwest::Client, log: &Log, job: &Job) {
    let ids = json!({
        "job": job.job_id,
        "source": job.source_id,
        "attempt": job.attempt,
        "kind": job.kind,
        "file": job.file_name,
        "leaseExpiresAt": job.lease_expires_at,
    });
    log.info("job claimed", ids.clone());

    let bytes = match download(http, &job.read_url).await {
        Ok(b) => b,
        Err(e) => return log.error("download failed", json!({ "ids": ids, "error": e })),
    };

    let outcome = match job.kind.as_str() {
        "document" => {
            let mime = document::mime_for(&job.file_name, &job.mime_type);
            match document::extract(bytes, &job.file_name, &mime).await {
                Ok(text) => match upload(http, &job.write_text, text.markdown.into_bytes()).await {
                    Ok(()) => Outcome::Success {
                        method: text.method.to_owned(),
                        audio_saved: None,
                    },
                    Err(e) => {
                        return log.error("text upload failed", json!({ "ids": ids, "error": e }));
                    }
                },
                Err(e) => {
                    log.error(
                        "document extraction failed",
                        json!({ "ids": ids, "error": e }),
                    );
                    Outcome::Failure {
                        code: "unreadable_document".to_owned(),
                        reason: "не удалось прочитать документ".to_owned(),
                    }
                }
            }
        }
        other => Outcome::Failure {
            code: "unsupported_kind".to_owned(),
            reason: format!("этот worker пока не умеет обрабатывать файлы вида «{other}»"),
        },
    };

    match api.complete(job, &outcome).await {
        Ok(()) => log.info(
            "job completed",
            json!({ "ids": ids, "outcome": outcome_name(&outcome) }),
        ),
        Err(e) => log.error(
            "complete failed",
            json!({ "ids": ids, "error": e.to_string() }),
        ),
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
