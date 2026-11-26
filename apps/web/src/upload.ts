import { isMedia, kindOf } from "@airepetitor/formats";

/** Reads audio/video duration from the media metadata; undefined when the browser cannot read it. */
export function mediaDuration(file: File): Promise<number | undefined> {
  const kind = kindOf(file.name, file.type);
  if (!kind || !isMedia(kind)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind === "video" ? "video" : "audio");
    const done = (seconds?: number) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      media.removeAttribute("src");
      resolve(seconds !== undefined && Number.isFinite(seconds) ? seconds : undefined);
    };
    const timer = setTimeout(() => done(), 5000);
    media.preload = "metadata";
    media.onloadedmetadata = () => done(media.duration);
    media.onerror = () => done();
    media.src = url;
  });
}

/** PUTs one file to a signed link, reporting progress from 0 to 1. */
export function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}
