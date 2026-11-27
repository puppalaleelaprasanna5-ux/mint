/**
 * Groq adapter tests. All HTTP is mocked: no real API calls are made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROQ_DEFAULT_MODEL, GroqProvider, resetGroqCooldown } from "./groq";
import { mockExplanation } from "./mock";
import { explainStock } from "../explain";
import { createAIProvider } from "../registry";
import { buildStockExplanationPrompt } from "../prompt";
import { buildExplanationContext, type StockExplanationContext } from "@/lib/ai/context";
import { buildTechnicalSummary } from "@/lib/technical-summary";
import { addDays, isWeekend } from "@/lib/time";
import type { BarDTO } from "@/lib/types";

const KEY = "gsk_TESTKEY1234567890abcdefghijklmnopqrstuvwxyz0123456789";

function bars(n: number): BarDTO[] {
  const out: BarDTO[] = [];
  let d = "2025-01-06";
  for (let i = 0; i < n; i++) {
    while (isWeekend(d)) d = addDays(d, 1);
    const close = 100 + i * 0.3 + 4 * Math.sin(i / 5);
    out.push({ time: d, timestamp: `${d}T03:45:00.000Z`, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 });
    d = addDays(d, 1);
  }
  return out;
}
const inst = { symbol: "TCS", name: "Tata Consultancy Services", type: "EQUITY", market: "NSE", currency: "INR" };
const summary = buildTechnicalSummary(bars(260), { isSimulated: false });
const ctx: StockExplanationContext = buildExplanationContext(inst, summary);

/** A Groq-shaped successful completion. */
const completion = (content: string, finish_reason = "stop") => ({
  id: "chatcmpl-test",
  object: "chat.completion",
  model: GROQ_DEFAULT_MODEL,
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }],
  usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200 },
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const groqError = (status: number, message: string, type = "invalid_request_error", headers: Record<string, string> = {}) =>
  json({ error: { message, type } }, status, headers);

const validContent = () => JSON.stringify({ ...mockExplanation(ctx), summary: "Prices rose over the year and moved sideways this month." });

let logged: string[] = [];
beforeEach(() => {
  resetGroqCooldown();
  logged = [];
  for (const m of ["error", "warn", "log", "info"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  }
});
afterEach(() => {
  // The key must never reach any log line, whatever happened in the test.
  expect(logged.join("\n")).not.toContain(KEY);
  vi.restoreAllMocks();
});

describe("GroqProvider: configuration", () => {
  it("reports a missing key by name only", () => {
    expect(new GroqProvider().status()).toMatchObject({ configured: false, missingEnv: ["GROQ_API_KEY"], isMock: false });
    expect(new GroqProvider({ apiKey: "   " }).status().configured).toBe(false);
  });

  it("never exposes the key through status, JSON or string conversion", () => {
    const p = new GroqProvider({ apiKey: KEY });
    expect(p.status().configured).toBe(true);
    expect(JSON.stringify(p.status())).not.toContain(KEY);
    expect(JSON.stringify(p)).not.toContain(KEY);
    expect(Object.values(p).join(" ")).not.toContain(KEY);
  });

  it("refuses to call the API without a key", async () => {
    const fetch = vi.fn();
    await expect(new GroqProvider({ fetch }).generateStockExplanation(ctx, { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: "NOT_CONFIGURED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("defaults to openai/gpt-oss-120b (llama-3.3-70b-versatile is no longer available)", () => {
    expect(GROQ_DEFAULT_MODEL).toBe("openai/gpt-oss-120b");
    expect(new GroqProvider({ apiKey: KEY }).model).toBe("openai/gpt-oss-120b");
    expect(new GroqProvider({ apiKey: KEY }).status().notes[0]).toBe("Model: openai/gpt-oss-120b");
  });

  it("uses the default model unless a valid GROQ_MODEL is given", () => {
    expect(new GroqProvider({ apiKey: KEY }).model).toBe(GROQ_DEFAULT_MODEL);
    expect(new GroqProvider({ apiKey: KEY, model: "llama-3.1-8b-instant" }).model).toBe("llama-3.1-8b-instant");
    expect(new GroqProvider({ apiKey: KEY, model: "bad model; rm -rf" }).model).toBe(GROQ_DEFAULT_MODEL);
  });
});

describe("GroqProvider: request", () => {
  it("sends the shared prompt in JSON mode with the key only in the Authorization header", async () => {
    const fetch = vi.fn(async () => json(completion(validContent())));
    await new GroqProvider({ apiKey: KEY, fetch }).generateStockExplanation(ctx, { signal: new AbortController().signal });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY}` });
    const body = JSON.parse(init.body as string);
    const prompt = buildStockExplanationPrompt(ctx);
    expect(body).toMatchObject({
      model: GROQ_DEFAULT_MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" },
      stream: false,
    });
    expect(body.max_completion_tokens).toBeGreaterThan(0);
    expect(body.temperature).toBeLessThanOrEqual(0.5);
    expect(init.body).not.toContain(KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  const sentBody = async (config: ConstructorParameters<typeof GroqProvider>[0]) => {
    const fetch = vi.fn(async () => json(completion(validContent())));
    await new GroqProvider({ apiKey: KEY, fetch, ...config }).generateStockExplanation(ctx, { signal: new AbortController().signal });
    return JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  };

  it("sends low reasoning effort and a 4096-token budget for the default GPT-OSS model", async () => {
    const body = await sentBody({});
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low", max_completion_tokens: 4096 });
    expect((await sentBody({ model: "openai/gpt-oss-20b" })).reasoning_effort).toBe("low");
  });

  it("omits reasoning_effort for non-GPT-OSS overrides (documented as GPT-OSS only)", async () => {
    const body = await sentBody({ model: "llama-3.1-8b-instant" });
    expect(body.model).toBe("llama-3.1-8b-instant");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("reads the answer from content and ignores the separate reasoning field", async () => {
    const reply = completion(validContent());
    (reply.choices[0].message as Record<string, unknown>).reasoning = "Let me think… the price will rise (internal reasoning)";
    const r = await explainStock(new GroqProvider({ apiKey: KEY, fetch: vi.fn(async () => json(reply)) }), ctx);
    expect(r.status).toBe("ok"); // reasoning text is never validated or shown, so it can't trip the policy
  });

  it("sends only computed facts, never raw price history", async () => {
    const fetch = vi.fn(async () => json(completion(validContent())));
    await new GroqProvider({ apiKey: KEY, fetch }).generateStockExplanation(ctx, { signal: new AbortController().signal });
    const sent = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string;
    expect(sent).not.toContain("timestamp");
    expect(sent.length).toBeLessThan(8000);
  });
});

describe("Groq through the explanation pipeline", () => {
  const run = (fetch: ReturnType<typeof vi.fn>, timeoutMs = 2000) => explainStock(new GroqProvider({ apiKey: KEY, fetch: fetch as never }), ctx, { timeoutMs });

  it("returns a validated, policy-clean explanation", async () => {
    const r = await run(vi.fn(async () => json(completion(validContent()))));
    expect(r).toMatchObject({ status: "ok", provider: "Groq", isMock: false });
    if (r.status === "ok") expect(r.explanation.summary).toMatch(/moved sideways/);
  });

  it("accepts JSON wrapped in a code fence", async () => {
    expect((await run(vi.fn(async () => json(completion("```json\n" + validContent() + "\n```"))))).status).toBe("ok");
  });

  it.each([
    ["non-JSON text", completion("Here is my analysis: the stock looks fine."), /not valid JSON/],
    ["wrong shape", completion(JSON.stringify({ answer: "hi" })), /did not match the schema/],
    ["truncated output", completion('{"summary": "Prices ro', "length"), /cut off/],
    ["empty content", completion(""), /no text content/],
    ["no choices", { id: "x", choices: [] }, /no choices/],
  ])("invalid response: %s → INVALID_RESPONSE", async (_label, body, reason) => {
    const r = await run(vi.fn(async () => json(body)));
    expect(r).toMatchObject({ status: "error", code: "INVALID_RESPONSE" });
    if (r.status === "error") expect(r.reason).toMatch(reason);
  });

  it("withholds unsafe model output (forecast / advice)", async () => {
    const unsafe = JSON.stringify({ ...mockExplanation(ctx), summary: "The stock will rise; you should buy now." });
    expect(await run(vi.fn(async () => json(completion(unsafe))))).toMatchObject({ status: "error", code: "POLICY_VIOLATION" });
  });

  it.each([
    [401, "Invalid API Key", "NOT_CONFIGURED", /rejected the API key/],
    [403, "Forbidden", "PROVIDER_ERROR", /denied access/],
    [404, "The model `x` does not exist", "PROVIDER_ERROR", /GROQ_MODEL/],
    [413, "Request too large", "PROVIDER_ERROR", /too large/],
    [400, "Failed to generate JSON. Please adjust your prompt.", "INVALID_RESPONSE", /valid JSON/],
    [400, "messages: field required", "PROVIDER_ERROR", /rejected the request/],
    [500, "internal", "PROVIDER_ERROR", /temporarily unavailable/],
    [503, "over capacity", "PROVIDER_ERROR", /temporarily unavailable/],
  ])("HTTP %i → %s", async (status, message, code, reason) => {
    const r = await run(vi.fn(async () => groqError(status, message)));
    expect(r).toMatchObject({ status: "error", code, provider: "Groq" });
    if (r.status === "error") expect(r.reason).toMatch(reason);
  });

  it("handles a non-JSON (HTML) error page", async () => {
    const r = await run(vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    expect(r).toMatchObject({ status: "error", code: "PROVIDER_ERROR" });
  });

  it("redacts the key if Groq echoes it in an error message", async () => {
    const r = await run(vi.fn(async () => groqError(401, `Invalid API Key: ${KEY}`)));
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(r)).toContain("[redacted]");
    const other = await run(vi.fn(async () => groqError(400, "bad key gsk_AnotherLookingKey123456789")));
    expect(JSON.stringify(other)).not.toMatch(/gsk_[A-Za-z0-9]{8,}/);
  });

  it("maps network failures without leaking details", async () => {
    const r = await run(vi.fn(async () => Promise.reject(new TypeError(`fetch failed for Bearer ${KEY}`))));
    expect(r).toEqual({ status: "error", code: "PROVIDER_ERROR", reason: "Network error contacting Groq.", provider: "Groq" });
  });

  it("times out and aborts the in-flight request", async () => {
    let aborted = false;
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    const r = await run(fetch, 30);
    expect(r).toMatchObject({ status: "error", code: "TIMEOUT" });
    expect(aborted).toBe(true);
  });
});

describe("Groq rate limits", () => {
  it("reports retry-after and stops calling Groq until the cooldown passes", async () => {
    let now = 1_000_000;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(groqError(429, "Rate limit reached for model", "tokens", { "retry-after": "7" }))
      .mockResolvedValue(json(completion(validContent())));
    const provider = () => new GroqProvider({ apiKey: KEY, fetch, now: () => now }); // new instance per request, like the app

    const first = await explainStock(provider(), ctx);
    expect(first).toMatchObject({ status: "error", code: "RATE_LIMITED", reason: expect.stringMatching(/Try again in 7s/) });

    now += 3000; // still cooling down: no API call is made
    const second = await explainStock(provider(), ctx);
    expect(second).toMatchObject({ status: "error", code: "RATE_LIMITED", reason: expect.stringMatching(/Try again in 4s/) });
    expect(fetch).toHaveBeenCalledTimes(1);

    now += 5000; // cooldown over
    expect((await explainStock(provider(), ctx)).status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses a 30s default cooldown when retry-after is missing or invalid", async () => {
    const now = 0;
    const r = await explainStock(new GroqProvider({ apiKey: KEY, fetch: vi.fn(async () => groqError(429, "slow down")), now: () => now }), ctx);
    expect(r).toMatchObject({ code: "RATE_LIMITED", reason: expect.stringMatching(/30s/) });
  });
});

describe("Groq failures never affect the analysis", () => {
  it("leaves the technical and risk summary unchanged after every failure mode", async () => {
    const before = structuredClone(summary);
    const failures = [
      vi.fn(async () => groqError(500, "boom")),
      vi.fn(async () => groqError(429, "limit")),
      vi.fn(async () => json(completion("not json"))),
      vi.fn(async () => Promise.reject(new Error("network down"))),
    ];
    for (const f of failures) {
      resetGroqCooldown();
      const r = await explainStock(new GroqProvider({ apiKey: KEY, fetch: f as never }), buildExplanationContext(inst, summary), { timeoutMs: 200 });
      expect(r.status).toBe("error");
    }
    expect(summary).toEqual(before);
  });
});

describe("createAIProvider with Groq", () => {
  it("stays disabled when AI_PROVIDER is not set, even if a key exists", () => {
    const { provider, status } = createAIProvider({ GROQ_API_KEY: KEY });
    expect(provider).toBeNull();
    expect(status.notes[0]).toMatch(/add AI_PROVIDER=groq/);
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it("stays disabled when AI_PROVIDER=groq but the key is missing", () => {
    const { provider, status } = createAIProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "  " });
    expect(provider).toBeNull();
    expect(status.missingEnv).toEqual(["GROQ_API_KEY"]);
  });

  it("creates a configured Groq provider, honouring GROQ_MODEL", () => {
    const { provider, status } = createAIProvider({ AI_PROVIDER: "Groq", GROQ_API_KEY: KEY, GROQ_MODEL: "openai/gpt-oss-20b" });
    expect(provider).toBeInstanceOf(GroqProvider);
    expect((provider as GroqProvider).model).toBe("openai/gpt-oss-20b");
    expect(status).toMatchObject({ configured: true, isMock: false });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it("falls back to the default model for an invalid GROQ_MODEL and says so", () => {
    const { provider, status } = createAIProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: KEY, GROQ_MODEL: "<script>" });
    expect((provider as GroqProvider).model).toBe(GROQ_DEFAULT_MODEL);
    expect(status.notes.join(" ")).toMatch(/not a valid model id/);
  });
});
