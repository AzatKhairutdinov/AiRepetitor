// Upload rules shared by the upload window (checked before upload) and the API (checked again).

export type SourceKind = "pdf" | "image" | "document" | "audio" | "video";

/** Accepted extensions and the kind of Source each one becomes. */
const KIND_BY_EXTENSION: Readonly<Record<string, SourceKind>> = {
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  heic: "image",
  webp: "image",
  docx: "document",
  odt: "document",
  rtf: "document",
  txt: "document",
  md: "document",
  pptx: "document",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  ogg: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
};

/** MIME types browsers report for the accepted extensions; an empty MIME is allowed (browsers often omit it). */
const MIME_PREFIXES_BY_KIND: Readonly<Record<SourceKind, readonly string[]>> = {
  pdf: ["application/pdf"],
  image: ["image/"],
  document: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.oasis.opendocument.text",
    "application/rtf",
    "text/rtf",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/octet-stream",
  ],
  audio: ["audio/", "application/ogg", "video/ogg"],
  video: ["video/", "application/octet-stream"],
};

/** 1 GB per file. */
export const MAX_FILE_BYTES = 1_000_000_000;

/** 2 hours of audio or video. */
export const MAX_MEDIA_SECONDS = 2 * 60 * 60;

/** The `accept` attribute for the file input. */
export const ACCEPT = Object.keys(KIND_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .join(",");

export const UNSUPPORTED_FORMAT = "Этот формат пока не поддерживается";
export const TOO_LARGE = "Файл больше 1 ГБ";
export const TOO_LONG = "Запись длиннее 2 часов";

export interface FileFacts {
  fileName: string;
  mimeType: string;
  size: number;
  /** Seconds, when the browser could read it from the media metadata. */
  durationSeconds?: number;
}

export type Verdict = { ok: true; kind: SourceKind } | { ok: false; reason: string };

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** The Source kind for a file, or null when the format is not accepted. */
export function kindOf(fileName: string, mimeType: string): SourceKind | null {
  const kind = KIND_BY_EXTENSION[extensionOf(fileName)];
  if (!kind) return null;
  const mime = mimeType.toLowerCase();
  if (mime === "") return kind;
  return MIME_PREFIXES_BY_KIND[kind].some((p) => mime.startsWith(p)) ? kind : null;
}

export const isMedia = (kind: SourceKind) => kind === "audio" || kind === "video";

/** Checks format, size and (for media with known duration) length. */
export function checkFile(file: FileFacts): Verdict {
  const kind = kindOf(file.fileName, file.mimeType);
  if (!kind) return { ok: false, reason: UNSUPPORTED_FORMAT };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: TOO_LARGE };
  if (
    isMedia(kind) &&
    file.durationSeconds !== undefined &&
    file.durationSeconds > MAX_MEDIA_SECONDS
  ) {
    return { ok: false, reason: TOO_LONG };
  }
  return { ok: true, kind };
}
