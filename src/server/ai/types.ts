import "server-only";
import type { StockExplanationContext } from "@/lib/ai/context";
import type { StockExplanation } from "@/lib/ai/schema";

export type AIErrorKind =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_RESPONSE"
  | "POLICY_VIOLATION"
  | "INSUFFICIENT_DATA"
  | "PROVIDER_ERROR";

/** Errors carry no secrets or raw model output; `message` is safe to log and show. */
export class AIError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AIError";
  }
}

export interface AIProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  /** Environment variable NAMES that are missing (never values). */
  missingEnv: string[];
  isMock: boolean;
  notes: string[];
}

export interface GenerateOptions {
  /** Aborted when Mint's timeout expires; providers should stop work and reject. */
  signal: AbortSignal;
}

/**
 * Provider-independent contract. Implementations return the model's RAW output (parsed JSON or a
 * JSON string). Validation, policy checks and safety post-processing happen centrally in
 * `explainStock`, so no provider is trusted to get them right.
 */
export interface AIProvider {
  readonly id: string;
  readonly name: string;
  status(): AIProviderStatus;
  generateStockExplanation(context: StockExplanationContext, options: GenerateOptions): Promise<unknown>;
}

export type ExplanationResult =
  | {
      status: "ok";
      explanation: StockExplanation;
      provider: string;
      isMock: boolean;
      generatedAt: string;
      disclaimer: string;
    }
  | { status: "disabled"; reason: string }
  | { status: "error"; code: AIErrorKind; reason: string; provider: string };
