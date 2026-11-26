import type { Env } from "../env.ts";
import type { ModelConfig } from "./chat.ts";

const DEEPINFRA = "https://api.deepinfra.com/v1/openai";

/** The Tutor's model, from settings. */
export const tutorModel = (env: Env): ModelConfig => ({
  baseUrl: env.TUTOR_BASE_URL || DEEPINFRA,
  model: env.TUTOR_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash",
  apiKey: env.DEEPINFRA_API_KEY,
});
