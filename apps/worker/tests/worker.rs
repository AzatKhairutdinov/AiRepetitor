//! Seam 3: the worker binary against a fake API and a fake OpenAI-compatible provider. Each test
//! hands it jobs and checks what it uploads and reports in `complete`.

use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const TOKEN: &str = "test-token";
/// Worker protocol the fake API speaks; must match the worker.
const PROTOCOL: &str = "4";

#[derive(Clone, Copy, PartialEq)]
enum Provider {
    /// Answers with text (vision) or two segments per chunk (speech).
    Answers,
    /// The vision model answers `UNREADABLE`.
    Unreadable,
    /// Every call fails with 503.
    Down,
}

#[derive(Default)]
struct State {
    jobs: Vec<Value>,
    files: HashMap<String, Vec<u8>>,
    puts: HashMap<String, Vec<u8>>,
    completes: Vec<Value>,
    model_calls: usize,
    /// Protocol header of the last claim.
    protocol: Option<String>,
    /// The worker's log after its run, for failure messages.
    log: String,
}

struct Fake {
    base: String,
    state: Arc<Mutex<State>>,
}

impl Fake {
    fn start(provider: Provider) -> Self {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("fake server");
        let base = format!(
            "http://{}",
            server.server_addr().to_ip().expect("ip address")
        );
        let state = Arc::new(Mutex::new(State::default()));
        let shared = Arc::clone(&state);
        thread::spawn(move || {
            // One thread per request: ffprobe opens a ranged connection while the first is open.
            for mut req in server.incoming_requests() {
                let shared = Arc::clone(&shared);
                thread::spawn(move || {
                    let mut body = Vec::new();
                    let _ = req.as_reader().read_to_end(&mut body);
                    let (code, out, headers) = handle(&shared, provider, &mut req, body);
                    let mut res = tiny_http::Response::from_data(out).with_status_code(code);
                    for (name, value) in headers {
                        res = res.with_header(
                            tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes())
                                .unwrap(),
                        );
                    }
                    let _ = req.respond(res);
                });
            }
        });
        Self { base, state }
    }

    /// Queues a job for `file` (served by the fake API) and returns its id.
    fn add_job(&self, kind: &str, file: &str, mime: &str, bytes: Vec<u8>) -> String {
        let mut s = self.state.lock().unwrap();
        let id = format!("job{}", s.jobs.len());
        s.files.insert(format!("/files/{id}"), bytes);
        let link =
            |what: &str| json!({ "url": format!("{}/{what}/{id}", self.base), "headers": {} });
        let mut job = json!({
            "jobId": id, "sourceId": id, "kind": kind, "mimeType": mime, "fileName": file,
            "size": 1, "attempt": 1, "leaseExpiresAt": "2030-01-01T00:00:00Z",
            "readUrl": format!("{}/files/{id}", self.base),
            "writeText": link("texts"),
            "visionPrompt": "Перепишите текст.",
        });
        if kind == "audio" || kind == "video" {
            job["writeAudio"] = link("audio");
        }
        s.jobs.push(job);
        id
    }

    /// Runs the worker until every queued job is completed, then stops it.
    fn run_worker(&self, timeout: Duration) {
        let expected = self.state.lock().unwrap().jobs.len();
        let logs = tempdir();
        let mut child = Command::new(env!("CARGO_BIN_EXE_airepetitor-worker"))
            .env("WORKER_TOKEN", TOKEN)
            .env("API_URL", &self.base)
            .env("DEEPINFRA_API_KEY", "test-key")
            .env("MODEL_BASE_URL", format!("{}/v1", self.base))
            .env("LOG_DIR", &logs)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("worker binary");
        let started = Instant::now();
        while self.state.lock().unwrap().completes.len() < expected {
            if started.elapsed() > timeout {
                stop(&mut child);
                let log = std::fs::read_to_string(logs.join("worker.log")).unwrap_or_default();
                panic!("the worker did not complete {expected} jobs in time; log:\n{log}");
            }
            thread::sleep(Duration::from_millis(100));
        }
        stop(&mut child);
        self.state.lock().unwrap().log =
            std::fs::read_to_string(logs.join("worker.log")).unwrap_or_default();
        let _ = std::fs::remove_dir_all(logs);
    }

    fn log(&self) -> String {
        self.state.lock().unwrap().log.clone()
    }

    fn complete(&self, job: &str) -> Value {
        let s = self.state.lock().unwrap();
        s.completes
            .iter()
            .find(|c| c["job"] == job)
            .cloned()
            .unwrap_or_else(|| panic!("no complete for {job}"))
    }

    fn text(&self, job: &str) -> String {
        let s = self.state.lock().unwrap();
        String::from_utf8_lossy(s.puts.get(&format!("/texts/{job}")).expect("uploaded text"))
            .into_owned()
    }
}

fn handle(
    state: &Mutex<State>,
    provider: Provider,
    req: &mut tiny_http::Request,
    body: Vec<u8>,
) -> (u16, Vec<u8>, Vec<(&'static str, String)>) {
    let url = req.url().to_owned();
    let header = |name: &str| {
        req.headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
            .map(|h| h.value.as_str().to_owned())
    };
    let mut s = state.lock().unwrap();
    match (req.method().as_str(), url.as_str()) {
        ("POST", "/worker/claim") => {
            s.protocol = header("x-worker-protocol");
            if header("authorization").as_deref() != Some(&format!("Bearer {TOKEN}")) {
                return (401, b"{}".to_vec(), vec![]);
            }
            if s.protocol.as_deref() != Some(PROTOCOL) {
                return (426, b"{\"message\":\"upgrade\"}".to_vec(), vec![]);
            }
            match s.jobs.iter_mut().find(|j| j["claimed"] != true) {
                Some(job) => {
                    job["claimed"] = true.into();
                    (200, job.to_string().into_bytes(), vec![])
                }
                None => (204, vec![], vec![]),
            }
        }
        ("POST", path) if path.ends_with("/complete") => {
            let mut done: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            done["job"] = path.split('/').nth(3).unwrap_or_default().into();
            s.completes.push(done);
            (204, vec![], vec![])
        }
        // Signed links serve Range requests as R2 does; ffprobe and ffmpeg seek with them.
        ("GET", path) => match s.files.get(path) {
            Some(bytes) => match header("range").and_then(|r| byte_range(&r, bytes.len())) {
                Some((from, to)) => (
                    206,
                    bytes[from..=to].to_vec(),
                    vec![
                        ("Accept-Ranges", "bytes".into()),
                        (
                            "Content-Range",
                            format!("bytes {from}-{to}/{}", bytes.len()),
                        ),
                    ],
                ),
                None => (200, bytes.clone(), vec![("Accept-Ranges", "bytes".into())]),
            },
            None => (404, vec![], vec![]),
        },
        ("PUT", path) => {
            s.puts.insert(path.to_owned(), body);
            (200, vec![], vec![])
        }
        ("POST", "/v1/chat/completions") => {
            s.model_calls += 1;
            let content = match provider {
                Provider::Down => return (503, b"busy".to_vec(), vec![]),
                Provider::Unreadable => "UNREADABLE",
                Provider::Answers => "Hablé con Ana.",
            };
            let answer = json!({
                "choices": [{ "message": { "content": content } }],
                "usage": { "prompt_tokens": 1500, "completion_tokens": 20 },
            });
            (200, answer.to_string().into_bytes(), vec![])
        }
        ("POST", "/v1/audio/transcriptions") => {
            s.model_calls += 1;
            if provider == Provider::Down {
                return (503, b"busy".to_vec(), vec![]);
            }
            let answer = json!({ "text": "…", "segments": [
                { "start": 1.5, "end": 4.0, "text": " Hola, ¿qué tal?" },
                { "start": 12.2, "end": 15.0, "text": "Добрый день" },
            ]});
            (200, answer.to_string().into_bytes(), vec![])
        }
        _ => (404, vec![], vec![]),
    }
}

/// `bytes=a-b`, `bytes=a-` or `bytes=-n` within `len`, as inclusive positions.
fn byte_range(header: &str, len: usize) -> Option<(usize, usize)> {
    let (from, to) = header.trim().strip_prefix("bytes=")?.split_once('-')?;
    let last = len.checked_sub(1)?;
    match (from.parse::<usize>().ok(), to.parse::<usize>().ok()) {
        (Some(a), Some(b)) if a <= b => Some((a, b.min(last))),
        (Some(a), None) if a <= last => Some((a, last)),
        (None, Some(n)) if n > 0 => Some((len.saturating_sub(n), last)),
        _ => None,
    }
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn tempdir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "airepetitor-worker-test-{}-{:?}",
        std::process::id(),
        thread::current().id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name),
    )
    .unwrap_or_else(|e| panic!("fixture {name}: {e}"))
}

const QUICK: Duration = Duration::from_secs(60);

#[test]
fn documents_become_markdown_without_a_model() {
    let fake = Fake::start(Provider::Answers);
    let txt = fake.add_job(
        "document",
        "lesson.txt",
        "text/plain",
        fixture("lesson.txt"),
    );
    let docx = fake.add_job(
        "document",
        "lesson.docx",
        "application/octet-stream",
        fixture("lesson.docx"),
    );
    let pptx = fake.add_job(
        "document",
        "lesson.pptx",
        "application/octet-stream",
        fixture("lesson.pptx"),
    );
    fake.run_worker(QUICK);

    for job in [&txt, &docx] {
        assert_eq!(fake.complete(job)["outcome"], "success", "{job}");
        assert!(fake.text(job).contains("pretérito indefinido"), "{job}");
    }
    assert_eq!(fake.complete(&pptx)["outcome"], "success");
    assert!(fake.text(&pptx).contains("Pretérito indefinido"));
    assert_eq!(fake.state.lock().unwrap().model_calls, 0);
}

#[test]
fn a_pdf_with_a_text_layer_stays_with_xberg() {
    let fake = Fake::start(Provider::Answers);
    let job = fake.add_job("pdf", "text.pdf", "application/pdf", fixture("text.pdf"));
    fake.run_worker(QUICK);

    let done = fake.complete(&job);
    assert_eq!(done["outcome"], "success");
    assert_eq!(done["method"], "xberg");
    assert!(done.get("usage").is_none());
    assert!(fake.text(&job).contains("indefinido"));
}

#[test]
fn a_scan_and_a_photo_go_to_the_vision_model_and_report_tokens() {
    let fake = Fake::start(Provider::Answers);
    let scan = fake.add_job("pdf", "scan.pdf", "application/pdf", fixture("scan.pdf"));
    let photo = fake.add_job("image", "photo.jpg", "image/jpeg", fixture("photo.jpg"));
    fake.run_worker(QUICK);

    for job in [&scan, &photo] {
        let done = fake.complete(job);
        assert_eq!(done["outcome"], "success", "{job}: {done}");
        assert_eq!(done["method"], "vision");
        assert_eq!(done["usage"][0]["inputTokens"], 1500);
        assert!(fake.text(job).contains("Hablé con Ana."));
    }
    assert!(fake.text(&scan).contains("<!-- страница 1 -->"));
}

#[test]
fn unreadable_pictures_fail_the_source_with_a_reason() {
    let fake = Fake::start(Provider::Unreadable);
    let scan = fake.add_job("pdf", "scan.pdf", "application/pdf", fixture("scan.pdf"));
    let photo = fake.add_job("image", "photo.jpg", "image/jpeg", fixture("photo.jpg"));
    fake.run_worker(QUICK);

    let done = fake.complete(&scan);
    assert_eq!(done["outcome"], "failure");
    assert_eq!(done["reason"], "не удалось прочитать страницу 1");
    let done = fake.complete(&photo);
    assert_eq!(
        done["reason"],
        "не удалось прочитать фото: текст не разобрать"
    );
    // The provider billed the call even though it found no text.
    assert_eq!(done["usage"][0]["outputTokens"], 20);
}

#[test]
fn provider_errors_are_retried_three_times_then_fail_the_source() {
    let fake = Fake::start(Provider::Down);
    let photo = fake.add_job("image", "photo.jpg", "image/jpeg", fixture("photo.jpg"));
    // Pauses of 1, 4 and 16 seconds between the four calls.
    fake.run_worker(Duration::from_secs(90));

    let done = fake.complete(&photo);
    assert_eq!(done["outcome"], "failure");
    assert_eq!(done["reason"], "временная ошибка распознавания");
    assert_eq!(fake.state.lock().unwrap().model_calls, 4);
}

#[test]
fn the_worker_speaks_the_api_protocol_version() {
    let fake = Fake::start(Provider::Answers);
    fake.add_job(
        "document",
        "lesson.txt",
        "text/plain",
        fixture("lesson.txt"),
    );
    fake.run_worker(QUICK);
    assert_eq!(
        fake.state.lock().unwrap().protocol.as_deref(),
        Some(PROTOCOL)
    );
}

/// Recordings need ffmpeg. CI sets REQUIRE_FFMPEG=1 so a missing ffmpeg fails there.
fn ffmpeg_or_skip() -> bool {
    let present = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok_and(|o| o.status.success());
    if !present {
        assert!(
            std::env::var_os("REQUIRE_FFMPEG").is_none(),
            "ffmpeg is required here (REQUIRE_FFMPEG is set)"
        );
        eprintln!("skipped: ffmpeg is not installed (brew install ffmpeg)");
    }
    present
}

/// A recording made by ffmpeg: a tone, plus a test picture for a video.
fn recording(seconds: u32, video: bool) -> Vec<u8> {
    let out = tempdir().join(if video { "clip.mp4" } else { "clip.ogg" });
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-v", "error", "-y", "-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=440:duration={seconds}"));
    if video {
        cmd.args(["-f", "lavfi", "-i"])
            .arg(format!("testsrc=size=160x120:rate=5:duration={seconds}"))
            .args(["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"]);
    } else {
        cmd.args(["-c:a", "libopus", "-b:a", "8k"]);
    }
    assert!(cmd.arg(&out).status().unwrap().success(), "ffmpeg fixture");
    std::fs::read(out).unwrap()
}

#[test]
fn a_video_becomes_timed_lines_and_its_audio_is_saved() {
    if !ffmpeg_or_skip() {
        return;
    }
    let fake = Fake::start(Provider::Answers);
    let job = fake.add_job("video", "lesson.mp4", "video/mp4", recording(20, true));
    fake.run_worker(QUICK);

    let done = fake.complete(&job);
    assert_eq!(
        done["outcome"],
        "success",
        "{done}\nworker log:\n{}",
        fake.log()
    );
    assert_eq!(done["method"], "whisper");
    assert_eq!(done["audioSaved"], true);
    let minutes = done["usage"][0]["audioMinutes"].as_f64().unwrap();
    assert!((minutes - 20.0 / 60.0).abs() < 0.02, "{minutes}");
    assert_eq!(
        fake.text(&job),
        "[00:00:01] Hola, ¿qué tal?\n\n[00:00:12] Добрый день"
    );
    let audio = fake.state.lock().unwrap().puts[&format!("/audio/{job}")].clone();
    assert_eq!(&audio[..4], b"OggS");
}

#[test]
fn a_recording_over_two_hours_is_refused() {
    if !ffmpeg_or_skip() {
        return;
    }
    let fake = Fake::start(Provider::Answers);
    let job = fake.add_job("audio", "long.ogg", "audio/ogg", recording(7300, false));
    fake.run_worker(QUICK);

    let done = fake.complete(&job);
    assert_eq!(done["outcome"], "failure");
    assert_eq!(
        done["reason"],
        "запись длиннее 2 часов",
        "worker log:\n{}",
        fake.log()
    );
    assert_eq!(fake.state.lock().unwrap().model_calls, 0);
}

#[test]
fn speech_recognition_errors_are_retried_three_times_then_fail_the_source() {
    if !ffmpeg_or_skip() {
        return;
    }
    let fake = Fake::start(Provider::Down);
    let job = fake.add_job("audio", "lesson.ogg", "audio/ogg", recording(20, false));
    // One chunk: four calls with pauses of 1, 4 and 16 seconds.
    fake.run_worker(Duration::from_secs(90));

    let done = fake.complete(&job);
    assert_eq!(done["outcome"], "failure");
    let log = fake.log();
    assert_eq!(
        done["reason"], "временная ошибка распознавания",
        "worker log:\n{log}"
    );
    assert_eq!(fake.state.lock().unwrap().model_calls, 4);
}
