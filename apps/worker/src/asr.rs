//! Speech to text through the OpenAI-compatible `audio/transcriptions` endpoint.

use crate::api::Usage;
use crate::provider::{CallError, clip, send_json, with_retries};
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

/// One recognised phrase; times in seconds from the start of the chunk.
pub struct Segment {
    pub start: f64,
    pub text: String,
}

pub struct Asr {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl Asr {
    pub fn new(http: reqwest::Client, base_url: &str, api_key: &str, model: &str) -> Self {
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key: api_key.to_owned(),
            model: model.to_owned(),
        }
    }

    /// An empty record of what this model spent.
    pub fn usage(&self) -> Usage {
        Usage::new(&self.model)
    }

    /// Transcribes one Ogg Opus chunk. The language is not set, so the model follows switches
    /// between languages. Err carries the last provider error after all retries.
    pub async fn transcribe(&self, ogg: &[u8]) -> Result<Vec<Segment>, String> {
        with_retries(|| self.call(ogg))
            .await
            .map_err(|e| format!("{}: {e}", self.model))
    }

    async fn call(&self, ogg: &[u8]) -> Result<Vec<Segment>, CallError> {
        let file = reqwest::multipart::Part::bytes(ogg.to_vec())
            .file_name("chunk.ogg")
            .mime_str("audio/ogg")
            .map_err(|e| CallError::Final(e.to_string()))?;
        let form = reqwest::multipart::Form::new()
            .part("file", file)
            .text("model", self.model.clone())
            .text("response_format", "verbose_json")
            .text("timestamp_granularities[]", "segment")
            .text("temperature", "0");
        let answer = send_json(
            self.http
                .post(format!("{}/audio/transcriptions", self.base_url))
                .bearer_auth(&self.api_key)
                .timeout(REQUEST_TIMEOUT)
                .multipart(form),
        )
        .await?;
        let Some(segments) = answer["segments"].as_array() else {
            return Err(CallError::Retryable(format!(
                "no segments in the answer: {}",
                clip(&answer.to_string())
            )));
        };
        Ok(segments
            .iter()
            .filter_map(|s| {
                let text = s["text"].as_str()?.trim();
                (!text.is_empty()).then(|| Segment {
                    start: s["start"].as_f64().unwrap_or(0.0),
                    text: text.to_owned(),
                })
            })
            .collect())
    }
}
