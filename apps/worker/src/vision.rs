//! Text out of one picture through a vision model on the OpenAI-compatible API.

use base64::Engine;
use serde::Serialize;
use serde_json::json;
use std::time::Duration;

/// Pauses before the 1st, 2nd and 3rd retry of a provider error.
const RETRY_PAUSES: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(4),
    Duration::from_secs(16),
];
/// The model's answer when the picture has no readable text (the Playbook asks for exactly this).
const UNREADABLE: &str = "UNREADABLE";
/// A dense page of handwriting stays well under this.
const MAX_TOKENS: u32 = 8192;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

/// Tokens of one model, reported to the API in `complete`.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

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

    /// Reads one JPEG. Err carries the last provider error after all retries.
    /// Every answered call adds its tokens to `usage`, failed or not.
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
        let mut last_error = String::new();
        for attempt in 0..=RETRY_PAUSES.len() {
            if attempt > 0 {
                tokio::time::sleep(RETRY_PAUSES[attempt - 1]).await;
            }
            match self.call(&body, usage).await {
                Ok(text) => return Ok(classify(&text)),
                Err(CallError::Final(e)) => return Err(format!("{}: {e}", self.model)),
                Err(CallError::Retryable(e)) => last_error = e,
            }
        }
        Err(format!("{}: {last_error}", self.model))
    }

    async fn call(&self, body: &serde_json::Value, usage: &mut Usage) -> Result<String, CallError> {
        let res = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .timeout(REQUEST_TIMEOUT)
            .json(body)
            .send()
            .await
            .map_err(|e| CallError::Retryable(e.to_string()))?;
        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            let message = format!(
                "HTTP {status}: {}",
                text.chars().take(300).collect::<String>()
            );
            // The same rule as the API's model client: only rate limits and server errors pass.
            return Err(if status.as_u16() == 429 || status.is_server_error() {
                CallError::Retryable(message)
            } else {
                CallError::Final(message)
            });
        }
        let answer: serde_json::Value = res
            .json()
            .await
            .map_err(|e| CallError::Retryable(e.to_string()))?;
        usage.input_tokens += answer["usage"]["prompt_tokens"].as_u64().unwrap_or(0);
        usage.output_tokens += answer["usage"]["completion_tokens"].as_u64().unwrap_or(0);
        let message = &answer["choices"][0]["message"];
        if !message.is_object() {
            return Err(CallError::Retryable(format!(
                "no choices in the answer: {}",
                answer.to_string().chars().take(300).collect::<String>()
            )));
        }
        Ok(message["content"].as_str().unwrap_or_default().to_owned())
    }
}

enum CallError {
    /// Network, rate limit, server error or a malformed answer: worth another try.
    Retryable(String),
    /// A client error such as a bad key or a rejected image: another try gives the same.
    Final(String),
}

fn classify(answer: &str) -> Reading {
    let text = answer.trim();
    if text.is_empty() || text.trim_matches('`').trim() == UNREADABLE {
        Reading::Unreadable
    } else {
        Reading::Text(text.to_owned())
    }
}
