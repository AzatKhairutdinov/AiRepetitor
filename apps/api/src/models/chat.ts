// One OpenAI-compatible Chat Completions client for every model. Only the common minimum:
// messages, temperature, response_format json_object.

export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Cost of this call in millionths of a dollar. */
  costMicroUsd: number;
}

/** The provider did not answer after all retries. */
class ModelUnavailable extends Error {}

/** Dollars per million tokens. Unknown models cost 0 and are logged. */
const PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  "deepseek-ai/DeepSeek-V4.1-Flash": { input: 0.2, output: 0.6 },
  "Qwen/Qwen3.5-397B-A17B": { input: 0.45, output: 3.0 },
  "Qwen/Qwen3-VL-30B-A3B-Instruct": { input: 0.15, output: 0.6 },
};

/** Pauses before the 1st, 2nd and 3rd retry. */
const RETRY_PAUSES_MS = [1000, 4000, 16000];

/** Cost of one call in millionths of a dollar; also prices the worker's vision calls. */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) {
    console.warn("No price for model", model);
    return 0;
  }
  // $ per million tokens × tokens = millionths of a dollar.
  return Math.round(price.input * inputTokens + price.output * outputTokens);
}

const retryable = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function chat(
  config: ModelConfig,
  messages: ChatMessage[],
  options: { json?: boolean; temperature?: number } = {},
): Promise<ChatResult> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_PAUSES_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_PAUSES_MS[attempt - 1]!);
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options.temperature ?? 0.2,
          ...(options.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (error) {
      lastError = String(error);
      continue;
    }
    if (!res.ok) {
      lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      if (retryable(res.status)) continue;
      break;
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      lastError = "empty answer";
      continue;
    }
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    return {
      text,
      inputTokens,
      outputTokens,
      costMicroUsd: costMicroUsd(config.model, inputTokens, outputTokens),
    };
  }
  throw new ModelUnavailable(`${config.model}: ${lastError}`);
}

/** Parses a JSON answer, tolerating a ```json fence around it. */
export function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return JSON.parse((fenced ? fenced[1]! : text).trim());
}
