import type { Language, LanguageCode } from "../../../libs/contract/src/server/api.schemas.ts";

/** Languages a Learner can study, with Russian names (also the Profile names). */
export const LANGUAGES: readonly Language[] = [
  { code: "en", name: "Английский" },
  { code: "es", name: "Испанский" },
  { code: "fr", name: "Французский" },
  { code: "de", name: "Немецкий" },
  { code: "it", name: "Итальянский" },
  { code: "pt", name: "Португальский" },
  { code: "zh", name: "Китайский" },
  { code: "ja", name: "Японский" },
  { code: "ko", name: "Корейский" },
  { code: "tr", name: "Турецкий" },
  { code: "sr", name: "Сербский" },
];

export function languageName(code: LanguageCode): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
