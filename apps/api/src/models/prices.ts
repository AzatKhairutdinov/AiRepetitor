// Prices of every model the Processing calls, in the API or in the worker.
import type { ModelUsage } from "../../../../libs/contract/src/server/api.schemas.ts";

/** Dollars per million tokens. */
const TOKEN_PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  "deepseek-ai/DeepSeek-V4.1-Flash": { input: 0.2, output: 0.6 },
  "Qwen/Qwen3.5-397B-A17B": { input: 0.45, output: 3.0 },
  "Qwen/Qwen3-VL-30B-A3B-Instruct": { input: 0.15, output: 0.6 },
};

/** Dollars per minute of audio. */
const MINUTE_PRICES: Readonly<Record<string, number>> = {
  "openai/whisper-large-v3-turbo": 0.0002,
  "openai/whisper-large-v3": 0.00045,
};

/** Cost of one token-priced call in millionths of a dollar. Unknown models cost 0 and are logged. */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = TOKEN_PRICES[model];
  if (!price) {
    console.warn("No token price for model", model);
    return 0;
  }
  // $ per million tokens × tokens = millionths of a dollar.
  return Math.round(price.input * inputTokens + price.output * outputTokens);
}

/** Cost of minutes of transcribed audio in millionths of a dollar. Unknown models cost 0 and are logged. */
function audioCostMicroUsd(model: string, minutes: number): number {
  const price = MINUTE_PRICES[model];
  if (price === undefined) {
    console.warn("No minute price for model", model);
    return 0;
  }
  return Math.round(price * minutes * 1_000_000);
}

/** What the worker reported spending on one job, in millionths of a dollar. */
export function usageCostMicroUsd(usage: readonly ModelUsage[] | undefined): number {
  return (usage ?? []).reduce((sum, u) => {
    const tokens =
      u.inputTokens || u.outputTokens
        ? costMicroUsd(u.model, u.inputTokens ?? 0, u.outputTokens ?? 0)
        : 0;
    const audio = u.audioMinutes ? audioCostMicroUsd(u.model, u.audioMinutes) : 0;
    return sum + tokens + audio;
  }, 0);
}
