//! Audio out of a recording with ffprobe and ffmpeg, read straight from the signed link.

use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Longer recordings fail the Source.
pub const MAX_SECONDS: f64 = 2.0 * 60.0 * 60.0;
/// Each chunk goes to speech recognition on its own.
const CHUNK_SECONDS: u32 = 10 * 60;
/// Reconnect on dropped HTTP reads of a large original.
const HTTP_INPUT: [&str; 6] = [
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "30",
];
/// A read that stalls this long (microseconds) fails instead of holding the job until its lease ends.
const READ_TIMEOUT: [&str; 2] = ["-rw_timeout", "120000000"];

/// True when both ffmpeg and ffprobe run.
pub async fn tools_available() -> bool {
    for tool in ["ffmpeg", "ffprobe"] {
        let ok = Command::new(tool)
            .arg("-version")
            .output()
            .await
            .is_ok_and(|out| out.status.success());
        if !ok {
            return false;
        }
    }
    true
}

pub struct Probe {
    pub seconds: f64,
    pub has_audio: bool,
}

/// Duration and whether there is an audio stream. Err carries a log message.
pub async fn probe(url: &str) -> Result<Probe, String> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-print_format", "json"])
        .args(["-show_entries", "format=duration:stream=codec_type"])
        .args(READ_TIMEOUT)
        .arg(url)
        .output()
        .await
        .map_err(|e| format!("cannot run ffprobe: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "ffprobe: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let info: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("ffprobe output: {e}"))?;
    let seconds = info["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .ok_or("ffprobe gave no duration")?;
    let has_audio = info["streams"]
        .as_array()
        .is_some_and(|s| s.iter().any(|s| s["codec_type"] == "audio"));
    Ok(Probe { seconds, has_audio })
}

/// The whole audio track as mono 16 kHz Opus (~24 kbit/s) in `dir/audio.ogg`.
pub async fn extract_audio(url: &str, dir: &Path) -> Result<PathBuf, String> {
    let audio = dir.join("audio.ogg");
    run_ffmpeg(
        Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y"])
            .args(HTTP_INPUT)
            .args(READ_TIMEOUT)
            .arg("-i")
            .arg(url)
            .args(["-vn", "-ac", "1", "-ar", "16000"])
            .args(["-c:a", "libopus", "-b:a", "24k", "-application", "voip"])
            .arg(&audio),
    )
    .await?;
    Ok(audio)
}

pub struct Chunk {
    pub path: PathBuf,
    /// Seconds from the start of the recording.
    pub start: f64,
    pub end: f64,
}

/// Cuts the audio into chunks of `CHUNK_SECONDS` without re-encoding.
pub async fn split(audio: &Path, dir: &Path) -> Result<Vec<Chunk>, String> {
    let list = dir.join("chunks.csv");
    run_ffmpeg(
        Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y", "-i"])
            .arg(audio)
            .args(["-f", "segment", "-segment_time"])
            .arg(CHUNK_SECONDS.to_string())
            .args(["-c", "copy", "-segment_list_type", "csv", "-segment_list"])
            .arg(&list)
            .arg(dir.join("chunk_%03d.ogg")),
    )
    .await?;
    let csv = tokio::fs::read_to_string(&list)
        .await
        .map_err(|e| e.to_string())?;
    csv.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            // name,start,end
            let mut parts = line.rsplitn(3, ',');
            let end = parts.next().and_then(|v| v.parse().ok());
            let start = parts.next().and_then(|v| v.parse().ok());
            match (parts.next(), start, end) {
                (Some(name), Some(start), Some(end)) => Ok(Chunk {
                    path: dir.join(name),
                    start,
                    end,
                }),
                _ => Err(format!("bad segment list line: {line}")),
            }
        })
        .collect()
}

async fn run_ffmpeg(cmd: &mut Command) -> Result<(), String> {
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("cannot run ffmpeg: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// `hh:mm:ss` of a moment of the recording.
pub fn timestamp(seconds: f64) -> String {
    // Whole seconds of a recording of at most a few hours fit easily.
    let total = seconds.max(0.0).floor() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        total % 3600 / 60,
        total % 60
    )
}
