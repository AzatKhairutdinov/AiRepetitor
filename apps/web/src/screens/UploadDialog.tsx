import {
  materialsConfirmUpload,
  profileMaterialsCreateMaterial,
} from "@airepetitor/contract/client";
import { ACCEPT, checkFile } from "@airepetitor/formats";
import { type DragEvent, useState } from "react";
import { mediaDuration, putFile } from "../upload.ts";

interface Picked {
  file: File;
  durationSeconds?: number;
  /** Why the file cannot be sent, shown right in the window. */
  problem?: string;
  progress: number;
}

interface Props {
  profileId: string;
  onClose: () => void;
  onUploaded: (materialId: string) => void;
}

/** Drop files, optionally name the Material, send it to the Tutor. */
export function UploadDialog({ profileId, onClose, onUploaded }: Props) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files) return;
    const next = await Promise.all(
      [...files].map(async (file): Promise<Picked> => {
        const durationSeconds = await mediaDuration(file);
        const verdict = checkFile({
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          durationSeconds,
        });
        return {
          file,
          ...(durationSeconds === undefined ? {} : { durationSeconds }),
          ...(verdict.ok ? {} : { problem: verdict.reason }),
          progress: 0,
        };
      }),
    );
    setPicked((current) => [...current, ...next]);
  }

  const remove = (index: number) => setPicked((current) => current.filter((_, i) => i !== index));
  const ready = picked.length > 0 && picked.every((p) => !p.problem);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const created = await profileMaterialsCreateMaterial(profileId, {
        ...(title.trim() ? { title: title.trim() } : {}),
        sources: picked.map((p) => ({
          fileName: p.file.name,
          mimeType: p.file.type,
          size: p.file.size,
          ...(p.durationSeconds === undefined ? {} : { durationSeconds: p.durationSeconds }),
        })),
      });
      if (created.status !== 201) throw new Error(created.data.message);
      const { material, uploads } = created.data;
      await Promise.all(
        uploads.map((upload, i) =>
          putFile(upload.url, upload.headers, picked[i]!.file, (fraction) =>
            setPicked((current) =>
              current.map((p, j) => (j === i ? { ...p, progress: fraction } : p)),
            ),
          ),
        ),
      );
      const confirmed = await materialsConfirmUpload(material.id);
      if (confirmed.status !== 200) throw new Error(confirmed.data.message);
      onUploaded(material.id);
    } catch (e) {
      setError(
        e instanceof Error && e.message !== "network" ? e.message : "Не удалось загрузить файлы",
      );
      setSending(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (!sending) void add(e.dataTransfer.files);
  };

  return (
    <dialog
      open
      aria-label="Загрузить материал"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <h2>Загрузить материал</h2>
      <p>Перетащите сюда файлы урока: PDF, фото, документы, аудио или видео.</p>
      <input
        type="file"
        multiple
        accept={ACCEPT}
        disabled={sending}
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <ul>
        {picked.map((p, i) => (
          <li key={`${p.file.name}-${i}`}>
            {p.file.name}
            {p.problem ? (
              <span role="alert"> — {p.problem}</span>
            ) : (
              sending && <progress value={p.progress} max={1} />
            )}
            {!sending && (
              <button type="button" onClick={() => remove(i)} aria-label={`Убрать ${p.file.name}`}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <label>
        Название (необязательно){" "}
        <input value={title} disabled={sending} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <p>
        <button type="button" disabled={!ready || sending} onClick={() => void send()}>
          Отправить репетитору
        </button>
        <button type="button" disabled={sending} onClick={onClose}>
          Отмена
        </button>
      </p>
    </dialog>
  );
}
