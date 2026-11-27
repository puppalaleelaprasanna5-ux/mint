import type { ReactNode } from "react";
import { AlertTriangle, FlaskConical, Info } from "lucide-react";
import { Card, CardHeader, Explainer, SimulatedBadge } from "@/components/ui";
import { formatPercent, formatPrice, formatTradingDate, formatVolume } from "@/lib/format";
import type { TechnicalSummary, IndicatorReading } from "@/lib/technical-summary";
import type { TrendAssessment, PriceLevel, Confidence } from "@/lib/trend-analysis";
import type { Metric, RiskAnalysis } from "@/lib/risk-analysis";

type Fmt = (v: number) => string;

const TONE = {
  up: "border-up/30 bg-up/10 text-up",
  down: "border-down/30 bg-down/10 text-down",
  neutral: "border-line-strong bg-surface-2 text-muted",
  warn: "border-warn/30 bg-warn-soft text-warn",
  none: "border-line bg-surface text-subtle",
};

function Pill({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function directionPill(direction: string, conflicting: boolean, kind: "trend" | "momentum" = "trend") {
  if (direction === "insufficient_data") return <Pill tone="none">Not enough data</Pill>;
  if (conflicting) return <Pill tone="warn">Mixed signals</Pill>;
  if (kind === "momentum") {
    if (direction === "bullish") return <Pill tone="up">Positive</Pill>;
    if (direction === "bearish") return <Pill tone="down">Negative</Pill>;
    return <Pill tone="neutral">Neutral</Pill>;
  }
  if (direction === "bullish") return <Pill tone="up">Uptrend</Pill>;
  if (direction === "bearish") return <Pill tone="down">Downtrend</Pill>;
  if (direction === "neutral") return <Pill tone="neutral">Neutral</Pill>;
  return <Pill tone="neutral">Sideways</Pill>;
}

function ConfidenceText({ c }: { c: Confidence }) {
  if (c.level === "none") return null;
  return <span className="text-xs text-subtle">{c.level} confidence</span>;
}

function Row({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">
        <span className="tabular-nums">{value}</span>
        {note ? <span className="block text-[11px] text-subtle">{note}</span> : null}
      </dd>
    </div>
  );
}

const needs = (r: { requiredBars: number }, have: number) => (
  <span className="text-xs text-subtle">
    needs {r.requiredBars} days (have {have})
  </span>
);

function vsPrice(value: number, close: number) {
  const diff = ((close - value) / value) * 100;
  return `price ${diff >= 0 ? "above" : "below"} by ${formatPercent(Math.abs(diff), { signed: false })}`;
}

// ───────────────────────────── Sections ─────────────────────────────

function TrendCard({ summary }: { summary: TechnicalSummary }) {
  const t = summary.trend!;
  const horizon = (a: TrendAssessment, label: string) => (
    <div className="space-y-1.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-center gap-2">
          <ConfidenceText c={a.confidence} />
          {directionPill(a.direction, a.conflicting)}
        </span>
      </div>
      {a.direction === "insufficient_data" ? (
        <p className="text-xs text-subtle">{a.explanation}</p>
      ) : (
        <ul className="space-y-1 text-xs text-muted">
          {a.signals.map((s) => (
            <li key={s.name} className="flex gap-2">
              <span className={s.vote > 0 ? "text-up" : s.vote < 0 ? "text-down" : "text-subtle"} aria-hidden>
                {s.vote > 0 ? "▲" : s.vote < 0 ? "▼" : "•"}
              </span>
              <span>{s.explanation}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Card>
      <CardHeader title="Trend" subtitle="Which way the price has been heading" />
      <div className="divide-y divide-line px-4 sm:px-5">
        {horizon(t.shortTerm, "Short term · about 1 month")}
        {horizon(t.longTerm, "Long term · about 1 year")}
        {t.alignment === "diverging" ? (
          <p className="py-2 text-xs text-warn">
            The short- and long-term trends point different ways. This often happens during pullbacks or early
            turns, and the outcome is uncertain.
          </p>
        ) : null}
      </div>
      <div className="px-4 pb-4 sm:px-5">
        <Explainer title="How is the trend decided?">
          <p>
            Three simple checks each vote up, down or neutral: is the price above its moving average, is the faster
            average above the slower one, and is the average itself rising? Two or more agreeing votes make a trend.
            If votes disagree, Mint says &ldquo;mixed signals&rdquo; instead of guessing.
          </p>
          <p>Confidence shows how many checks agree. It is not a probability of what happens next.</p>
        </Explainer>
      </div>
    </Card>
  );
}

function MomentumCard({ summary }: { summary: TechnicalSummary }) {
  const m = summary.trend!.momentum;
  const s = summary.snapshot!;
  const n = summary.barsAnalyzed;
  const zoneLabel: Record<string, string> = {
    overbought: "overbought (≥ 70)",
    bullish: "positive",
    neutral: "neutral",
    bearish: "negative",
    oversold: "oversold (≤ 30)",
  };
  return (
    <Card>
      <CardHeader
        title="Momentum · RSI & MACD"
        subtitle="How strongly the price has been moving lately"
        right={
          <span className="flex items-center gap-2">
            <ConfidenceText c={m.confidence} />
            {directionPill(m.bias, m.conflicting, "momentum")}
          </span>
        }
      />
      <dl className="divide-y divide-line px-4 sm:px-5">
        <Row
          label="RSI (14)"
          value={s.rsi14.value !== null ? s.rsi14.value.toFixed(1) : needs(s.rsi14, n)}
          note={m.rsiZone ? zoneLabel[m.rsiZone] : undefined}
        />
        <Row
          label="MACD line"
          value={s.macd.macd !== null ? s.macd.macd.toFixed(2) : needs({ requiredBars: 26 }, n)}
          note={s.macd.macd !== null ? (s.macd.macd >= 0 ? "12-day avg above 26-day" : "12-day avg below 26-day") : undefined}
        />
        <Row label="Signal line" value={s.macd.signal !== null ? s.macd.signal.toFixed(2) : needs(s.macd, n)} />
        <Row
          label="Histogram"
          value={s.macd.histogram !== null ? s.macd.histogram.toFixed(2) : needs(s.macd, n)}
          note={m.histogramTrend ? `${m.histogramTrend}` : undefined}
        />
      </dl>
      {m.cautions.length ? (
        <ul className="mx-4 mb-3 space-y-1 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs text-warn sm:mx-5">
          {m.cautions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-2 px-4 pb-4 sm:px-5">
        <Explainer title="What is RSI?">
          <p>
            The Relative Strength Index compares recent gains with recent losses on a 0–100 scale. Above 50, gains
            have outweighed losses over the last 14 days; below 50, losses have.
          </p>
          <p>
            Above 70 is called &ldquo;overbought&rdquo; and below 30 &ldquo;oversold&rdquo;. These describe how fast
            the price moved, not what it will do next.
          </p>
        </Explainer>
        <Explainer title="What is MACD?">
          <p>
            MACD is the gap between a fast (12-day) and slow (26-day) average. Above zero means the recent average is
            higher. The signal line is a smoothed MACD; when MACD is above it, short-term momentum has been
            improving. The histogram is the gap between the two.
          </p>
        </Explainer>
      </div>
    </Card>
  );
}

function AveragesCard({ summary, fmt }: { summary: TechnicalSummary; fmt: Fmt }) {
  const s = summary.snapshot!;
  const n = summary.barsAnalyzed;
  const avg = (label: string, r: IndicatorReading) => (
    <Row label={label} value={r.value !== null ? fmt(r.value) : needs(r, n)} note={r.value !== null ? vsPrice(r.value, s.close) : undefined} />
  );
  const b = s.bollinger;
  let position: string | undefined;
  if (b.percentB !== null) {
    position =
      b.percentB > 1
        ? "price is above the upper band"
        : b.percentB < 0
          ? "price is below the lower band"
          : `price is ${Math.round(b.percentB * 100)}% of the way from lower to upper band`;
  } else if (b.middle !== null) {
    position = "bands are flat (no recent price movement)";
  }
  return (
    <Card>
      <CardHeader title="Moving averages & Bollinger Bands" subtitle="Smoothed prices and the normal trading range" />
      <dl className="divide-y divide-line px-4 sm:px-5">
        {avg("SMA 20", s.sma20)}
        {avg("SMA 50", s.sma50)}
        {avg("SMA 200", s.sma200)}
        {avg("EMA 12", s.ema12)}
        {avg("EMA 26", s.ema26)}
        <Row label="Bollinger upper" value={b.upper !== null ? fmt(b.upper) : needs(b, n)} />
        <Row label="Bollinger middle (SMA 20)" value={b.middle !== null ? fmt(b.middle) : needs(b, n)} note={position} />
        <Row
          label="Bollinger lower"
          value={b.lower !== null ? fmt(b.lower) : needs(b, n)}
          note={b.bandwidth !== null ? `band width ${formatPercent(b.bandwidth * 100, { signed: false })} of price` : undefined}
        />
      </dl>
      <div className="space-y-2 px-4 pb-4 sm:px-5">
        <Explainer title="SMA vs EMA">
          <p>
            A Simple Moving Average (SMA) is the plain average closing price over the last N days. An Exponential
            Moving Average (EMA) gives recent days more weight, so it reacts faster. The 200-day SMA is widely used as
            a long-term reference line.
          </p>
        </Explainer>
        <Explainer title="What are Bollinger Bands?">
          <p>
            Lines two standard deviations above and below the 20-day average. Most closing prices fall between them.
            Wide bands mean the price has been swinging a lot; narrow bands mean it has been calm. Touching a band is
            not by itself a buy or sell signal.
          </p>
        </Explainer>
      </div>
    </Card>
  );
}

function VolumeCard({ summary, currency }: { summary: TechnicalSummary; currency: string }) {
  const v = summary.snapshot!.volume;
  const n = summary.barsAnalyzed;
  return (
    <Card>
      <CardHeader title="Volume" subtitle="How many shares changed hands" />
      {!v.available ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-5">
          No volume data. Indices are calculated numbers, not traded directly, so they have no trading volume.
        </p>
      ) : (
        <dl className="divide-y divide-line px-4 sm:px-5">
          <Row label="Latest session" value={formatVolume(v.latest, currency)} />
          <Row label="20-day average" value={v.average20 !== null ? formatVolume(v.average20, currency) : needs({ requiredBars: 20 }, n)} />
          <Row
            label="Relative volume"
            value={v.relative !== null ? `${v.relative.toFixed(2)}×` : needs(v, n)}
            note={v.relative !== null ? `latest vs the previous 20-day average` : undefined}
          />
          <Row
            label="Spikes (last 20 sessions)"
            value={v.spikesLast20}
            note={v.lastSpikeDate ? `most recent ${formatTradingDate(v.lastSpikeDate)}` : "days with ≥ 2× normal volume"}
          />
        </dl>
      )}
      <div className="px-4 pb-4 sm:px-5">
        <Explainer title="Why does volume matter?">
          <p>
            Volume shows how much interest there was. A price move on unusually high volume (a spike, here at least
            twice the normal level) involved more traders than a move on thin volume. Relative volume of 1.0× is a
            normal day.
          </p>
        </Explainer>
      </div>
    </Card>
  );
}

function LevelsCard({ summary, fmt }: { summary: TechnicalSummary; fmt: Fmt }) {
  const l = summary.trend!.levels;
  const list = (levels: PriceLevel[], empty: string, tone: "up" | "down") =>
    levels.length ? (
      <ul className="divide-y divide-line">
        {levels.map((x) => (
          <li key={x.price} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="tabular-nums">{fmt(x.price)}</span>
            <span className="text-right text-xs text-subtle">
              <span className={tone === "up" ? "text-up" : "text-down"}>{formatPercent(x.distancePercent)}</span> · {x.strength} ·{" "}
              {x.touches} touch{x.touches === 1 ? "" : "es"} · last {formatTradingDate(x.lastTouched)}
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="py-1.5 text-xs text-subtle">{empty}</p>
    );
  return (
    <Card>
      <CardHeader title="Support & resistance" subtitle={l.insufficientData ? "Not enough data" : `From turning points in the last ${l.barsUsed} sessions`} />
      <div className="space-y-3 px-4 py-3 sm:px-5">
        {l.insufficientData ? (
          <p className="text-sm text-muted">{l.explanation}</p>
        ) : l.support.length === 0 && l.resistance.length === 0 ? (
          <p className="text-sm text-muted">
            No clear turning points in the last {l.barsUsed} sessions, so there are no support or resistance levels
            yet. The price has moved in one direction without notable reversals.
          </p>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">Resistance (above price)</p>
              {list(l.resistance, "None: the price is above every recent turning point.", "up")}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">Support (below price)</p>
              {list(l.support, "None: the price is below every recent turning point.", "down")}
            </div>
          </>
        )}
      </div>
      <div className="px-4 pb-4 sm:px-5">
        <Explainer title="What are support and resistance?">
          <p>
            Support is a price where falls have stopped before; resistance is where rises have stopped before. More
            touches make a level more notable. They are zones, not exact prices, and they can break.
          </p>
        </Explainer>
      </div>
    </Card>
  );
}

function metricValue(m: Metric, render: (v: number) => string) {
  return m.status === "ok" && m.value !== null ? render(m.value) : <span className="text-xs text-subtle">{m.status === "unavailable" ? "unavailable" : "not enough data"}</span>;
}

function RiskCard({ risk }: { risk: RiskAnalysis }) {
  const pct = (v: number) => formatPercent(v * 100, { signed: false });
  const levelTone = { low: "up", moderate: "neutral", high: "warn", very_high: "down", insufficient_data: "none" } as const;
  const levelLabel = { low: "Low", moderate: "Moderate", high: "High", very_high: "Very high", insufficient_data: "Not enough data" };
  const items: [string, Metric, (v: number) => string][] = [
    ["Volatility (annualized)", risk.volatility, pct],
    ["Maximum drawdown", risk.maxDrawdown, (v) => `−${pct(v)}`],
    ["Downside deviation", risk.downsideDeviation, pct],
    ["Average daily return", risk.averageDailyReturn, (v) => formatPercent(v * 100)],
    ["Total return (period)", risk.totalReturn, (v) => formatPercent(v * 100)],
    ["Beta", risk.beta, (v) => v.toFixed(2)],
  ];
  return (
    <Card>
      <CardHeader
        title="Risk"
        subtitle={`From ${risk.returnsAnalyzed} daily returns`}
        right={<Pill tone={levelTone[risk.riskLevel]}>{levelLabel[risk.riskLevel]} risk</Pill>}
      />
      <p className="px-4 pt-3 text-xs text-muted sm:px-5">{risk.riskExplanation}</p>
      <dl className="divide-y divide-line px-4 sm:px-5">
        {items.map(([label, m, render]) => (
          <div key={label} className="py-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular-nums">{metricValue(m, render)}</dd>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">{m.explanation}</p>
          </div>
        ))}
      </dl>
      {risk.cautions.length ? (
        <ul className="mx-4 mb-3 space-y-1 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs text-warn sm:mx-5">
          {risk.cautions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-2 px-4 pb-4 sm:px-5">
        <Explainer title="Volatility, drawdown and downside deviation">
          <p>
            <strong className="text-fg">Volatility</strong> measures how much the price typically swings, up or down,
            scaled to a year. <strong className="text-fg">Maximum drawdown</strong> is the biggest fall from a peak:
            the worst loss someone who bought at the top would have seen. <strong className="text-fg">Downside
            deviation</strong> is like volatility but only counts the falling days.
          </p>
        </Explainer>
        <Explainer title="What is beta?">
          <p>
            Beta compares a stock&apos;s daily moves with a market index. 1.0 means it moved like the index, 1.5 means
            about 50% more, 0.5 about half. Mint only calculates it when the index data is real, not simulated.
          </p>
        </Explainer>
      </div>
    </Card>
  );
}

// ───────────────────────────── Section ─────────────────────────────

export function TechnicalAnalysis({
  summary,
  currency,
  instrumentType,
}: {
  summary: TechnicalSummary;
  currency: string;
  instrumentType: string;
}) {
  const fmt: Fmt = (v) => formatPrice(v, currency, instrumentType);

  return (
    <section aria-labelledby="ta-heading" className="grid grid-cols-1 gap-4 lg:gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ta-heading" className="text-lg font-semibold tracking-tight">
            Technical analysis
          </h2>
          {summary.isSimulated ? <SimulatedBadge /> : null}
        </div>
        <p className="text-sm text-muted">
          {summary.asOf
            ? `Calculated from ${summary.barsAnalyzed} daily closing prices up to ${formatTradingDate(summary.asOf)}.`
            : "No price history to analyse."}
        </p>
        <div
          role="note"
          className={`flex gap-2 rounded-lg border px-3 py-2 text-xs ${summary.isSimulated ? "border-warn/30 bg-warn-soft text-warn" : "border-line bg-surface-2 text-muted"}`}
        >
          {summary.isSimulated ? <FlaskConical className="mt-px size-3.5 shrink-0" aria-hidden /> : <Info className="mt-px size-3.5 shrink-0" aria-hidden />}
          <span>
            {summary.isSimulated ? (
              <>
                <strong className="font-semibold">These results come from SIMULATED prices</strong> and are only for
                learning how the tools work.{" "}
              </>
            ) : null}
            Everything here describes how the price behaved in the past. It is not a prediction or investment advice,
            and patterns often break.
          </span>
        </div>
      </div>

      {summary.error ? (
        <Card>
          <div className="flex gap-3 px-4 py-5 text-sm sm:px-5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-down" aria-hidden />
            <div>
              <p className="font-medium">Analysis could not be calculated</p>
              <p className="mt-1 text-muted">The stored price data failed a validity check: {summary.error}</p>
            </div>
          </div>
        </Card>
      ) : !summary.snapshot || !summary.trend || !summary.risk ? (
        <Card>
          <p className="px-4 py-8 text-center text-sm text-muted sm:px-5">
            No price history is stored for this instrument, so there is nothing to analyse yet.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6 xl:grid-cols-3">
          <TrendCard summary={summary} />
          <MomentumCard summary={summary} />
          <RiskCard risk={summary.risk} />
          <AveragesCard summary={summary} fmt={fmt} />
          <VolumeCard summary={summary} currency={currency} />
          <LevelsCard summary={summary} fmt={fmt} />
        </div>
      )}
    </section>
  );
}
