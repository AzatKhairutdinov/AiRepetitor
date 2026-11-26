//! Shared rules for calls to the OpenAI-compatible model provider: which errors to retry and when.

use std::{future::Future, time::Duration};

/// Pauses before the 1st, 2nd and 3rd retry of a provider error.
const RETRY_PAUSES: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(4),
    Duration::from_secs(16),
];

pub enum CallError {
    /// Network, rate limit, server error or a malformed answer: worth another try.
    Retryable(String),
    /// A client error such as a bad key or a rejected file: another try gives the same.
    Final(String),
}

/// Runs `call` until it succeeds, fails for good, or the retries run out. Err carries the last error.
pub async fn with_retries<T, F, Fut>(mut call: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, CallError>>,
{
    let mut last_error = String::new();
    for attempt in 0..=RETRY_PAUSES.len() {
        if attempt > 0 {
            tokio::time::sleep(RETRY_PAUSES[attempt - 1]).await;
        }
        match call().await {
            Ok(value) => return Ok(value),
            Err(CallError::Final(e)) => return Err(e),
            Err(CallError::Retryable(e)) => last_error = e,
        }
    }
    Err(last_error)
}

/// Sends a request and reads a JSON answer. Only rate limits and server errors are retried,
/// the same rule as the API's model client.
pub async fn send_json(req: reqwest::RequestBuilder) -> Result<serde_json::Value, CallError> {
    let res = req
        .send()
        .await
        .map_err(|e| CallError::Retryable(e.to_string()))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        let message = format!("HTTP {status}: {}", clip(&text));
        return Err(if status.as_u16() == 429 || status.is_server_error() {
            CallError::Retryable(message)
        } else {
            CallError::Final(message)
        });
    }
    res.json()
        .await
        .map_err(|e| CallError::Retryable(e.to_string()))
}

/// The first 300 characters, for logs.
pub fn clip(text: &str) -> String {
    text.chars().take(300).collect()
}
