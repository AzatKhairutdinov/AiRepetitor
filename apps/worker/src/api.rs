//! Client of the worker protocol: `claim` and `complete` (ADR 0003).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Must match `WORKER_PROTOCOL` in the API.
pub const PROTOCOL: &str = "4";

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
    /// PDF and images: the vision model instruction of the Processing's Playbook edition.
    pub vision_prompt: Option<String>,
    /// Audio and video: where to PUT the extracted audio track (Opus in Ogg).
    pub write_audio: Option<WriteLink>,
}

/// What one model spent on a job; the API prices it and adds it to the Processing cost.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub model: String,
    #[serde(skip_serializing_if = "is_zero")]
    pub input_tokens: u64,
    #[serde(skip_serializing_if = "is_zero")]
    pub output_tokens: u64,
    /// Minute-priced models (speech recognition).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_minutes: Option<f64>,
}

impl Usage {
    pub fn new(model: &str) -> Self {
        Self {
            model: model.to_owned(),
            input_tokens: 0,
            output_tokens: 0,
            audio_minutes: None,
        }
    }

    /// True when there is anything to bill.
    pub fn is_spent(&self) -> bool {
        self.input_tokens + self.output_tokens > 0 || self.audio_minutes.is_some_and(|m| m > 0.0)
    }
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

#[derive(Debug, Serialize, PartialEq)]
// `rename_all` names the variants; `rename_all_fields` gives the API `audioSaved`.
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "outcome"
)]
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

    /// Reports the result with the model tokens spent on it, so the API adds their cost.
    pub async fn complete(
        &self,
        job: &Job,
        outcome: &Outcome,
        usage: &[Usage],
    ) -> Result<(), ApiError> {
        let mut body = serde_json::to_value(outcome).map_err(|e| ApiError::Other(e.to_string()))?;
        body["attempt"] = job.attempt.into();
        if !usage.is_empty() {
            body["usage"] =
                serde_json::to_value(usage).map_err(|e| ApiError::Other(e.to_string()))?;
        }
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
