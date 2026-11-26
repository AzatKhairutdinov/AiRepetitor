//! Text out of one picture through a vision model on the OpenAI-compatible API.

use crate::api::Usage;
use crate::provider::{CallError, clip, send_json, with_retries};
use base64::Engine;
use serde_json::json;
use std::time::Duration;

/// The model's answer when the picture has no readable text (the Playbook asks for exactly this).
const UNREADABLE: &str = "UNREADABLE";
/// A dense page of handwriting stays well under this.
const MAX_TOKENS: u32 = 8192;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, PartialEq)]
pub enum Reading {
    Text(String),
    /// `UNREADABLE` or an empty answer.
    Unreadable,
}

pub struct Vision {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl Vision {
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

    /// Reads one JPEG. Err carries the last provider error after all retries.
    /// The successful call adds its tokens to `usage`; answers that are retried are not counted.
    pub async fn read(
        &self,
        prompt: &str,
        jpeg: &[u8],
        usage: &mut Usage,
    ) -> Result<Reading, String> {
        let data_url = format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(jpeg)
        );
        let body = json!({
            "model": self.model,
            "temperature": 0,
            "max_tokens": MAX_TOKENS,
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "text", "text": prompt },
                    { "type": "image_url", "image_url": { "url": data_url } },
                ],
            }],
        });
        let (text, input, output) = with_retries(|| self.call(&body))
            .await
            .map_err(|e| format!("{}: {e}", self.model))?;
        usage.input_tokens += input;
        usage.output_tokens += output;
        Ok(classify(&text))
    }

    async fn call(&self, body: &serde_json::Value) -> Result<(String, u64, u64), CallError> {
        let answer = send_json(
            self.http
                .post(format!("{}/chat/completions", self.base_url))
                .bearer_auth(&self.api_key)
                .timeout(REQUEST_TIMEOUT)
                .json(body),
        )
        .await?;
        let message = &answer["choices"][0]["message"];
        if !message.is_object() {
            return Err(CallError::Retryable(format!(
                "no choices in the answer: {}",
                clip(&answer.to_string())
            )));
        }
        Ok((
            message["content"].as_str().unwrap_or_default().to_owned(),
            answer["usage"]["prompt_tokens"].as_u64().unwrap_or(0),
            answer["usage"]["completion_tokens"].as_u64().unwrap_or(0),
        ))
    }
}

fn classify(answer: &str) -> Reading {
    let text = answer.trim();
    if text.is_empty() || text.trim_matches('`').trim() == UNREADABLE {
        Reading::Unreadable
    } else {
        Reading::Text(text.to_owned())
    }
}
