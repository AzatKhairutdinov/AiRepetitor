//! JSON-lines log in the user's log folder, mirrored to stderr.

use serde_json::{Map, Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    sync::Mutex,
    time::SystemTime,
};

pub struct Log {
    file: Mutex<Option<File>>,
}

impl Log {
    pub fn open(dir: &Path) -> Self {
        let file = fs::create_dir_all(dir)
            .and_then(|()| {
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(dir.join("worker.log"))
            })
            .map_err(|e| eprintln!("cannot open log in {}: {e}", dir.display()))
            .ok();
        Self {
            file: Mutex::new(file),
        }
    }

    pub fn info(&self, msg: &str, fields: Value) {
        self.write("info", msg, fields);
    }

    pub fn error(&self, msg: &str, fields: Value) {
        self.write("error", msg, fields);
    }

    fn write(&self, level: &str, msg: &str, fields: Value) {
        let mut line = Map::new();
        line.insert(
            "ts".into(),
            json!(humantime::format_rfc3339_millis(SystemTime::now()).to_string()),
        );
        line.insert("level".into(), json!(level));
        line.insert("msg".into(), json!(msg));
        if let Value::Object(extra) = fields {
            line.extend(extra);
        }
        let text = Value::Object(line).to_string();
        eprintln!("{text}");
        if let Ok(mut guard) = self.file.lock()
            && let Some(file) = guard.as_mut()
        {
            let _ = writeln!(file, "{text}");
        }
    }
}
