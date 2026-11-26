import type { Env } from "../env.ts";
import type { ModelConfig } from "./chat.ts";

const DEEPINFRA = "https://api.deepinfra.com/v1/openai";

/** The Tutor's model, from settings. */
export const tutorModel = (env: Env): ModelConfig => ({
  baseUrl: env.TUTOR_BASE_URL || DEEPINFRA,
  model: env.TUTOR_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash",
  apiKey: env.DEEPINFRA_API_KEY,
});

/** The Methodologist's model, from settings. */
export const methodologistModel = (env: Env): ModelConfig => ({
  baseUrl: env.METHODOLOGIST_BASE_URL || DEEPINFRA,
  model: env.METHODOLOGIST_MODEL || "Qwen/Qwen3.5-397B-A17B",
  apiKey: env.DEEPINFRA_API_KEY,
});

/** Revision rounds after the Methodologist (REVISION_ROUNDS, default 1). */
export function revisionRounds(env: Env): number {
  const n = Number(env.REVISION_ROUNDS ?? "1");
  return Number.isInteger(n) && n >= 0 ? n : 1;
}
