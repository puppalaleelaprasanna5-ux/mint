import "server-only";
import type { StockExplanationContext } from "@/lib/ai/context";
import { buildStockExplanationPrompt } from "../prompt";
import { AIError, type AIProvider, type AIProviderStatus, type GenerateOptions } from "../types";

/**
 * Groq adapter (OpenAI-compatible chat completions).
 *
 * API: POST https://api.groq.com/openai/v1/chat/completions, Authorization: Bearer GROQ_API_KEY
 * Docs: https://console.groq.com/docs/api-reference, /docs/errors, /docs/rate-limits, /docs/reasoning
 *   - JSON mode: response_format {"type": "json_object"}; output text in choices[0].message.content
 *   - errors: {"error": {"message", "type"}}; 429 carries a `retry-after` header (seconds)
 *
 * This adapter only transports text. Schema validation, the content policy, safety additions and
 * the overall timeout are applied centrally by `explainStock`.
 *
 * The API key is held in a private field and only ever placed in the Authorization header. It is
 * never included in status, errors or logs, and provider error text is redacted before use.
 */

/**
 * Default model. llama-3.3-70b-versatile was shut down for developer-tier usage, so the default is
 * GPT-OSS 120B, a production model on Groq (https://console.groq.com/docs/models). GROQ_MODEL overrides it.
 */
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * GPT-OSS models are reasoning models. Groq documents `reasoning_effort` (low/medium/high) as
 * supported ONLY by GPT-OSS 20B/120B, so it is sent only for those. Reasoning is returned in a
 * separate `reasoning` field, so `message.content` still holds just the JSON answer.
 * (https://console.groq.com/docs/reasoning)
 */
export function isGptOssModel(model: string): boolean {
  return model.startsWith("openai/gpt-oss-");
}

/**
 * Completion token budget. Groq's docs do not say whether reasoning tokens count toward
 * max_completion_tokens, so this leaves ample headroom over the ~1k-token JSON answer.
 * A cut-off reply is still caught (finish_reason "length" → INVALID_RESPONSE).
 */
export const GROQ_DEFAULT_MAX_COMPLETION_TOKENS = 4096;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const MODEL_ID = /^[A-Za-z0-9._/:-]{1,100}$/;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GroqConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  temperature?: number;
  maxCompletionTokens?: number;
  /** Clock for rate-limit cooldowns (tests). */
  now?: () => number;
}

/** Cooldown after a 429, shared by all adapter instances in this server process. */
const cooldownUntil = new Map<string, number>();

/** For tests. */
export function resetGroqCooldown(): void {
  cooldownUntil.clear();
}

export function isValidGroqModel(model: string): boolean {
  return MODEL_ID.test(model);
}

export class GroqProvider implements AIProvider {
  readonly id = "groq";
  readonly name = "Groq";
  readonly model: string;
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #temperature: number;
  readonly #maxTokens: number;
  readonly #now: () => number;

  constructor(config: GroqConfig = {}) {
    this.#apiKey = config.apiKey?.trim() || undefined;
    const model = config.model?.trim();
    this.model = model && isValidGroqModel(model) ? model : GROQ_DEFAULT_MODEL;
    this.#baseUrl = (config.baseUrl ?? GROQ_BASE_URL).replace(/\/$/, "");
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
    this.#temperature = config.temperature ?? 0.2;
    this.#maxTokens = config.maxCompletionTokens ?? GROQ_DEFAULT_MAX_COMPLETION_TOKENS;
    this.#now = config.now ?? Date.now;
  }

  status(): AIProviderStatus {
    return {
      id: this.id,
      name: this.name,
      configured: Boolean(this.#apiKey),
      missingEnv: this.#apiKey ? [] : ["GROQ_API_KEY"],
      isMock: false,
      notes: [`Model: ${this.model}`, "Sends only Mint's computed analysis facts (no price history or personal data) to Groq."],
    };
  }

  /** Removes the key (and any Groq-style key) from provider-supplied text. */
  #redact(text: string): string {
    let out = text.replace(/gsk_[A-Za-z0-9]{8,}/g, "[redacted]");
    if (this.#apiKey) out = out.split(this.#apiKey).join("[redacted]");
    return out.length > 200 ? `${out.slice(0, 200)}…` : out;
  }

  async generateStockExplanation(context: StockExplanationContext, { signal }: GenerateOptions): Promise<unknown> {
    if (!this.#apiKey) throw new AIError("NOT_CONFIGURED", "GROQ_API_KEY is not set.");

    const until = cooldownUntil.get(this.#baseUrl) ?? 0;
    const now = this.#now();
    if (now < until) {
      throw new AIError("RATE_LIMITED", `Groq rate limit reached. Try again in ${Math.ceil((until - now) / 1000)}s.`);
    }

    const prompt = buildStockExplanationPrompt(context);
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          temperature: this.#temperature,
          max_completion_tokens: this.#maxTokens,
          ...(isGptOssModel(this.model) ? { reasoning_effort: "low" } : {}),
          response_format: { type: "json_object" },
          stream: false,
        }),
        signal,
      });
    } catch (err) {
      if (signal.aborted || (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))) {
        throw new AIError("TIMEOUT", "Groq request was cancelled after the timeout.");
      }
      throw new AIError("PROVIDER_ERROR", "Network error contacting Groq.");
    }

    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!res.ok) throw this.#httpError(res, body);

    const choice = (body as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | null)?.choices?.[0];
    if (!choice) throw new AIError("INVALID_RESPONSE", "Groq response had no choices.");
    if (choice.finish_reason === "length") {
      throw new AIError("INVALID_RESPONSE", "Groq response was cut off before it finished (token limit).");
    }
    const content = choice.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AIError("INVALID_RESPONSE", "Groq response had no text content.");
    }
    return content;
  }

  #httpError(res: Response, body: unknown): AIError {
    const err = (body as { error?: { message?: unknown; type?: unknown } } | null)?.error;
    const detail = this.#redact(
      [typeof err?.type === "string" ? err.type : null, typeof err?.message === "string" ? err.message : null].filter(Boolean).join(": ") ||
        `HTTP ${res.status}`,
    );
    switch (res.status) {
      case 401:
        return new AIError("NOT_CONFIGURED", `Groq rejected the API key (401). Check GROQ_API_KEY in .env. (${detail})`);
      case 403:
        return new AIError("PROVIDER_ERROR", `Groq denied access (403): ${detail}`);
      case 404:
        return new AIError("PROVIDER_ERROR", `Groq model or endpoint not found (404). Check GROQ_MODEL. (${detail})`);
      case 413:
        return new AIError("PROVIDER_ERROR", `Request too large for Groq (413): ${detail}`);
      case 429: {
        const retryAfter = Number(res.headers.get("retry-after"));
        const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : 30;
        cooldownUntil.set(this.#baseUrl, this.#now() + seconds * 1000);
        return new AIError("RATE_LIMITED", `Groq rate limit reached. Try again in ${Math.ceil(seconds)}s.`);
      }
      case 400:
      case 422:
        return /json/i.test(detail)
          ? new AIError("INVALID_RESPONSE", `Groq could not produce valid JSON (${res.status}): ${detail}`)
          : new AIError("PROVIDER_ERROR", `Groq rejected the request (${res.status}): ${detail}`);
      default:
        return res.status >= 500 || res.status === 498
          ? new AIError("PROVIDER_ERROR", `Groq is temporarily unavailable (${res.status}). Try again later.`)
          : new AIError("PROVIDER_ERROR", `Groq request failed (${res.status}): ${detail}`);
    }
  }
}
