// Learner-facing reasons of a failed Material: on the Material card and in the Chat.
import type { MaterialFailure } from "@airepetitor/flows";

/** Reason for each failure of «Обработка материала». */
export const FAILURE_REASON: Record<MaterialFailure, string> = {
  noSourceRead: "Не удалось прочитать ни один файл",
  tutorUnavailable: "Репетитор сейчас недоступен",
};

/** A wait that timed out or a step that kept failing. */
export const PROCESSING_BROKE = "Не удалось обработать материал";
