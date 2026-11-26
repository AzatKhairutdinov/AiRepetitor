import type {
  MaterialStatus,
  MaterialSummary,
  SourceStatus,
} from "../../../libs/contract/src/client/api.schemas.ts";

export const MATERIAL_STATUS: Record<MaterialStatus, string> = {
  uploading: "загружается",
  uploaded: "загружен",
  queued: "в очереди",
  processing: "обрабатывается",
  topicsReady: "темы готовы",
  noTopics: "без тем",
  failed: "ошибка",
};

export const SOURCE_STATUS: Record<SourceStatus, string> = {
  uploading: "загружается",
  uploaded: "загружен",
  queued: "в очереди",
  extracting: "извлекается",
  extracted: "текст извлечён",
  failed: "ошибка",
};

export const materialTitle = (m: MaterialSummary) =>
  m.title ??
  `Материал от ${new Date(m.createdAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}`;
