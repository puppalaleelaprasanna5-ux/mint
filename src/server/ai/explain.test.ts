import { describe, expect, it, vi } from "vitest";
import { explainStock } from "./explain";
import { MockAIProvider, mockExplanation } from "./providers/mock";
import { createAIProvider } from "./registry";
import { buildStockExplanationPrompt } from "./prompt";
import { AIError, type AIProvider } from "./types";
import { AI_DISCLAIMER, findPolicyViolations, stockExplanationSchema } from "@/lib/ai/schema";
import { buildExplanationContext, type StockExplanationContext } from "@/lib/ai/context";
import { buildTechnicalSummary } from "@/lib/technical-summary";
import { addDays, isWeekend } from "@/lib/time";
import type { BarDTO } from "@/lib/types";

function bars(n: number): BarDTO[] {
  const out: BarDTO[] = [];
  let d = "2025-01-06";
  for (let i = 0; i < n; i++) {
    while (isWeekend(d)) d = addDays(d, 1);
    const close = 100 + i * 0.3 + 4 * Math.sin(i / 5);
    out.push({ time: d, timestamp: `${d}T03:45:00.000Z`, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 + (i % 7) * 50 });
    d = addDays(d, 1);
  }
  return out;
}
const inst = { symbol: "TCS", name: "Tata Consultancy Services", type: "EQUITY", market: "NSE", currency: "INR" };
const ctxFor = (n: number, isSimulated = true): StockExplanationContext =>
  buildExplanationContext(inst, buildTechnicalSummary(bars(n), { isSimulated }));

/** Provider stub returning a fixed raw value. */
const stub = (impl: AIProvider["generateStockExplanation"], isMock = false): AIProvider => ({
  id: "stub",
  name: "Stub",
  status: () => ({ id: "stub", name: "Stub", configured: true, missingEnv: [], isMock, notes: [] }),
  generateStockExplanation: impl,
});

describe("explainStock", () => {
  it("returns 'disabled' (not an error) when no provider is configured", async () => {
    expect(await explainStock(null, ctxFor(260))).toEqual({ status: "disabled", reason: expect.stringMatching(/AI_PROVIDER/) });
  });

  it("produces a validated, policy-clean explanation from the mock provider", async () => {
    const r = await explainStock(new MockAIProvider(), ctxFor(260));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(stockExplanationSchema.safeParse(r.explanation).success).toBe(true);
    expect(findPolicyViolations(r.explanation)).toEqual([]);
    expect(r).toMatchObject({ isMock: true, provider: "Mock AI (development)", disclaimer: AI_DISCLAIMER });
    expect(r.explanation.summary).toMatch(/SIMULATED/);
    expect(Date.parse(r.generatedAt)).not.toBeNaN();
  });

  it("is grounded in the analysis facts", async () => {
    const ctx = ctxFor(260);
    const r = await explainStock(new MockAIProvider(), ctx);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.explanation.risk).toContain(`${ctx.risk?.volatilityPct}%`);
    expect(r.explanation.summary).toContain("260 daily closes");
  });

  it("adds a simulated-data limitation even if the provider omitted it", async () => {
    const { limitations: _l, ...rest } = mockExplanation(ctxFor(260, false));
    void _l;
    const provider = stub(async () => ({ ...rest, limitations: ["Past prices only."] }));
    const r = await explainStock(provider, ctxFor(260, true));
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.explanation.limitations[0]).toMatch(/SIMULATED/);
    // and does not add it for real data
    const real = await explainStock(provider, ctxFor(260, false));
    if (real.status !== "ok") throw new Error(real.status);
    expect(real.explanation.limitations).toEqual(["Past prices only."]);
  });

  it("accepts JSON text, including a ```json fenced block", async () => {
    const body = JSON.stringify(mockExplanation(ctxFor(260)));
    expect((await explainStock(stub(async () => body), ctxFor(260))).status).toBe("ok");
    expect((await explainStock(stub(async () => "```json\n" + body + "\n```"), ctxFor(260))).status).toBe("ok");
  });

  it.each([
    ["invalid" as const, "INVALID_RESPONSE", /did not match the schema/],
    ["unsafe" as const, "POLICY_VIOLATION", /forecasts a price move|promises an outcome/],
    ["error" as const, "PROVIDER_ERROR", /Mock provider failure/],
  ])("mock mode %s → %s", async (mode, code, reason) => {
    const r = await explainStock(new MockAIProvider(mode), ctxFor(260));
    expect(r).toMatchObject({ status: "error", code });
    if (r.status === "error") expect(r.reason).toMatch(reason);
  });

  it("returns INVALID_RESPONSE for non-JSON text", async () => {
    const r = await explainStock(stub(async () => "Sure! Here's my analysis..."), ctxFor(260));
    expect(r).toMatchObject({ status: "error", code: "INVALID_RESPONSE", reason: expect.stringMatching(/not valid JSON/) });
  });

  it("times out a hanging provider and aborts it", async () => {
    let aborted = false;
    const provider = stub(
      (_ctx, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new AIError("TIMEOUT", "aborted"));
          });
        }),
    );
    const r = await explainStock(provider, ctxFor(260), { timeoutMs: 30 });
    expect(r).toMatchObject({ status: "error", code: "TIMEOUT" });
    expect(aborted).toBe(true);
    expect((await explainStock(new MockAIProvider("hang"), ctxFor(260), { timeoutMs: 30 })).status).toBe("error");
  });

  it("never throws, and hides unexpected error details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await explainStock(stub(async () => { throw new Error("socket hang up: secret-internal-host:443"); }), ctxFor(260));
    expect(r).toEqual({ status: "error", code: "PROVIDER_ERROR", reason: "The AI provider failed unexpectedly.", provider: "Stub" });
    const sync = await explainStock(stub(() => { throw new TypeError("sync boom"); }), ctxFor(260));
    expect(sync.status).toBe("error");
    spy.mockRestore();
  });

  it("does not call the provider without enough analysed data", async () => {
    const generate = vi.fn();
    const r = await explainStock(stub(generate), buildExplanationContext(inst, buildTechnicalSummary([], { isSimulated: false })));
    expect(r).toMatchObject({ status: "error", code: "INSUFFICIENT_DATA" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("leaves the technical and risk analysis untouched whatever the AI does", async () => {
    const summary = buildTechnicalSummary(bars(260), { isSimulated: true });
    const before = structuredClone(summary);
    const ctx = buildExplanationContext(inst, summary);
    const evil = stub(async (c) => {
      // A misbehaving provider mutating its input, including arrays shared with the analysis.
      c.momentum?.cautions.push("injected by provider");
      (c as { risk: unknown }).risk = null;
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const p of [evil, new MockAIProvider("error"), new MockAIProvider("unsafe"), new MockAIProvider()]) {
      await explainStock(p, ctx, { timeoutMs: 50 });
    }
    expect(summary).toEqual(before); // the analysis object itself is never touched
    vi.restoreAllMocks();
  });
});

describe("createAIProvider", () => {
  it("is disabled unless AI_PROVIDER is set", () => {
    expect(createAIProvider({}).provider).toBeNull();
    expect(createAIProvider({ AI_PROVIDER: " none " }).provider).toBeNull();
    expect(createAIProvider({}).status.missingEnv).toEqual(["AI_PROVIDER"]);
  });

  it("selects the mock provider", () => {
    const { provider, status } = createAIProvider({ AI_PROVIDER: "Mock" });
    expect(provider).toBeInstanceOf(MockAIProvider);
    expect(status).toMatchObject({ configured: true, isMock: true });
  });

  it("does not pretend to support unknown providers", () => {
    const { provider, status } = createAIProvider({ AI_PROVIDER: "openai", OPENAI_API_KEY: "should-not-be-used" });
    expect(provider).toBeNull();
    expect(status.configured).toBe(false);
    expect(status.notes[0]).toMatch(/not supported/);
    expect(JSON.stringify(status)).not.toContain("should-not-be-used");
  });
});

describe("buildStockExplanationPrompt", () => {
  it("includes the facts and the safety rules", () => {
    const ctx = ctxFor(260);
    const p = buildStockExplanationPrompt(ctx);
    expect(p.system).toMatch(/Do NOT predict prices/);
    expect(p.system).toMatch(/Do NOT tell the user to buy, sell or hold/);
    expect(p.system).toMatch(/isSimulated/);
    expect(p.user).toContain('"symbol": "TCS"');
    expect(p.user).toContain(`"barsAnalyzed": 260`);
  });
});
