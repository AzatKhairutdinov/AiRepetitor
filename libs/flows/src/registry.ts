import type { AnyStateMachine } from "xstate";
import { MATERIAL_PROCESSING_VERSION, materialProcessing } from "./materialProcessing.ts";
import { SOURCE_EXTRACTION_VERSION, sourceExtraction } from "./sourceExtraction.ts";
import { TOPIC_DIGEST_VERSION, topicDigest } from "./topicDigest.ts";

export interface FlowEntry {
  machine: AnyStateMachine;
  /** Scenario name in Russian. */
  title: string;
  version: number;
}

/** Every Processing scenario; the Team diagrams page lists exactly these. */
export const FLOWS: readonly FlowEntry[] = [
  {
    machine: materialProcessing,
    title: "Обработка материала",
    version: MATERIAL_PROCESSING_VERSION,
  },
  { machine: sourceExtraction, title: "Извлечение исходника", version: SOURCE_EXTRACTION_VERSION },
  { machine: topicDigest, title: "Конспект темы", version: TOPIC_DIGEST_VERSION },
];
