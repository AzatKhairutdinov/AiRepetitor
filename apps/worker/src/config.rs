//! Configuration from environment variables.

use std::{env, path::PathBuf};

#[derive(Clone, Debug)]
pub struct Config {
    /// Base URL of the AiRepetitor API, without a trailing slash.
    pub api_url: String,
    /// Shared secret, the same as `WORKER_TOKEN` of the API.
    pub worker_token: String,
    /// Key for the OpenAI-compatible model provider; without it only model-free jobs are taken.
    pub deepinfra_api_key: Option<String>,
    /// OpenAI-compatible base URL, without `/chat/completions`.
    pub model_base_url: String,
    pub vision_model: String,
    pub asr_model: String,
    pub log_dir: PathBuf,
    /// pdfium shared library downloaded by `scripts/install-pdfium.sh`.
    pub pdfium_library: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let worker_token = non_empty("WORKER_TOKEN").ok_or("WORKER_TOKEN is not set")?;
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        Ok(Self {
            api_url: non_empty("API_URL")
                .unwrap_or_else(|| "http://localhost:8787".to_owned())
                .trim_end_matches('/')
                .to_owned(),
            worker_token,
            deepinfra_api_key: non_empty("DEEPINFRA_API_KEY"),
            model_base_url: non_empty("MODEL_BASE_URL")
                .unwrap_or_else(|| "https://api.deepinfra.com/v1/openai".to_owned()),
            vision_model: non_empty("VISION_MODEL")
                .unwrap_or_else(|| "Qwen/Qwen3-VL-30B-A3B-Instruct".to_owned()),
            asr_model: non_empty("ASR_MODEL")
                .unwrap_or_else(|| "openai/whisper-large-v3-turbo".to_owned()),
            log_dir: non_empty("LOG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("Library/Logs/AiRepetitor")),
            pdfium_library: non_empty("PDFIUM_LIBRARY")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    home.join(".local/lib/airepetitor").join(format!(
                        "{}pdfium{}",
                        env::consts::DLL_PREFIX,
                        env::consts::DLL_SUFFIX
                    ))
                }),
        })
    }

    /// Source kinds this worker can extract now. Pictures, PDFs and recordings need the model key
    /// (a PDF may turn out to be a scan); PDFs also need pdfium, recordings ffmpeg and ffprobe.
    pub fn kinds(&self, has_pdfium: bool, has_ffmpeg: bool) -> Vec<&'static str> {
        let mut kinds = vec!["document"];
        if self.deepinfra_api_key.is_some() {
            kinds.push("image");
            if has_pdfium {
                kinds.push("pdf");
            }
            if has_ffmpeg {
                kinds.extend(["audio", "video"]);
            }
        }
        kinds
    }
}

fn non_empty(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
}
