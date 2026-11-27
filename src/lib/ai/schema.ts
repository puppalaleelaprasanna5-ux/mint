/**
 * Standard, provider-independent response schema for AI stock explanations, plus a content-policy
 * check. Every provider's output must pass BOTH before Mint shows it.
 *
 * An explanation restates and interprets facts Mint already computed (trend, momentum, risk,
 * levels). It must not forecast prices, promise outcomes or tell the user to buy/sell.
 */
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const stockExplanationSchema = z
  .object({
    /** 2–4 plain-English sentences summarising the current picture. */
    summary: text(800),
    trend: z.object({ shortTerm: text(400), longTerm: text(400) }).strict(),
    momentum: text(400),
    risk: text(400),
    keyLevels: text(400),
    /** Neutral things a learner could look at next (not instructions to trade). */
    considerations: z.array(text(240)).min(1).max(5),
    /** What the explanation cannot know or may get wrong. At least one is required. */
    limitations: z.array(text(240)).min(1).max(5),
    /** How clear the underlying signals are, mirroring Mint's own confidence. Not a forecast. */
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

export type StockExplanation = z.infer<typeof stockExplanationSchema>;

/** Mint's own disclaimer, attached to every AI result; providers' wording is never relied on. */
export const AI_DISCLAIMER =
  "AI-generated explanation of historical data, for learning only. It may be wrong, it is not a prediction, and it is not investment advice.";

/**
 * Phrases that turn an explanation into a forecast, a promise or a trading instruction.
 * Matching is deliberately conservative: a false positive only means the explanation is withheld.
 */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  // Negated forms ("no guarantee", "not risk-free") are responsible wording and are allowed.
  { pattern: /(?<!\b(?:no|not|never|without|nor)\s+(?:a\s+|any\s+)?)\bguarantee(?:d|s)?\b/i, reason: "promises an outcome" },
  { pattern: /(?<!\b(?:not|never|nor|isn't|is not)\s+)\brisk[-\s]?free\b/i, reason: "claims an investment is risk-free" },
  { pattern: /\b(?:100|hundred)\s?%\s?(?:sure|certain|safe)\b/i, reason: "claims certainty" },
  { pattern: /\bwill\s+(?:definitely|certainly|surely|undoubtedly)\b/i, reason: "claims certainty about the future" },
  { pattern: /\b(?:price|stock|share|it)\s+will\s+(?:rise|fall|climb|drop|go up|go down|reach|hit|double|crash|recover)\b/i, reason: "forecasts a price move" },
  { pattern: /\bprice\s+target\b/i, reason: "gives a price target" },
  { pattern: /\b(?:you|we|i)\s+(?:should|must|recommend(?:\s+that\s+you)?)\s+(?:buy|sell|short|invest|exit)\b/i, reason: "gives a trading instruction" },
  { pattern: /\b(?:buy|sell)\s+(?:now|immediately|today)\b/i, reason: "gives a trading instruction" },
  { pattern: /\b(?:strong\s+)?(?:buy|sell)\s+(?:signal|rating|recommendation)\b/i, reason: "gives a buy/sell rating" },
];

export interface PolicyViolation {
  field: string;
  phrase: string;
  reason: string;
}

function collectStrings(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectStrings(v, path ? `${path}.${k}` : k, out);
  }
}

export function findPolicyViolations(explanation: StockExplanation): PolicyViolation[] {
  const strings: { path: string; text: string }[] = [];
  collectStrings(explanation, "", strings);
  const violations: PolicyViolation[] = [];
  for (const s of strings) {
    for (const rule of FORBIDDEN) {
      const m = rule.pattern.exec(s.text);
      if (m) violations.push({ field: s.path, phrase: m[0], reason: rule.reason });
    }
  }
  return violations;
}
