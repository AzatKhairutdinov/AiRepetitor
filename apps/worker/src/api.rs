//! Client of the worker protocol: `claim` and `complete` (ADR 0003).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Must match `WORKER_PROTOCOL` in the API.
pub const PROTOCOL: &str = "2";

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WriteLink {
    pub url: String,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub job_id: String,
    pub source_id: String,
    pub kind: String,
    pub mime_type: String,
    pub file_name: String,
    pub attempt: u32,
    pub lease_expires_at: String,
    pub read_url: String,
    pub write_text: WriteLink,
    // Media fields (duration, audio link) are read by the media ticket.
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum Outcome {
    #[serde(rename = "success")]
    Success {
        method: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        audio_saved: Option<bool>,
    },
    #[serde(rename = "failure")]
    Failure { code: String, reason: String },
}

#[derive(Debug)]
pub enum ApiError {
    /// The API speaks another protocol version (HTTP 426).
    Upgrade(String),
    Other(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Upgrade(m) => write!(f, "protocol mismatch: {m}"),
            Self::Other(m) => write!(f, "{m}"),
        }
    }
}

pub struct Api {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl Api {
    pub fn new(http: reqwest::Client, base: &str, token: &str) -> Self {
        Self {
            http,
            base: base.to_owned(),
            token: token.to_owned(),
        }
    }

    fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .post(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .header("x-worker-protocol", PROTOCOL)
    }

    /// The next job, or None when the queue is empty.
    pub async fn claim(&self, kinds: &[&str]) -> Result<Option<Job>, ApiError> {
        let res = self
            .post("/worker/claim")
            .json(&serde_json::json!({ "kinds": kinds }))
            .send()
            .await
            .map_err(|e| ApiError::Other(e.to_string()))?;
        match res.status().as_u16() {
            200 => res
                .json()
                .await
                .map(Some)
                .map_err(|e| ApiError::Other(e.to_string())),
            204 => Ok(None),
            426 => Err(ApiError::Upgrade(res.text().await.unwrap_or_default())),
            code => Err(ApiError::Other(format!(
                "claim: HTTP {code}: {}",
                res.text().await.unwrap_or_default()
            ))),
        }
    }

    pub async fn complete(&self, job: &Job, outcome: &Outcome) -> Result<(), ApiError> {
        let mut body = serde_json::to_value(outcome).map_err(|e| ApiError::Other(e.to_string()))?;
        body["attempt"] = job.attempt.into();
        let res = self
            .post(&format!("/worker/jobs/{}/complete", job.job_id))
            .json(&body)
            .send()
            .await
            .map_err(|e| ApiError::Other(e.to_string()))?;
        match res.status().as_u16() {
            204 => Ok(()),
            426 => Err(ApiError::Upgrade(res.text().await.unwrap_or_default())),
            code => Err(ApiError::Other(format!(
                "complete: HTTP {code}: {}",
                res.text().await.unwrap_or_default()
            ))),
        }
    }
}
