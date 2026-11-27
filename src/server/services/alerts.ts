import "server-only";
import { db } from "@/server/db";
import { notFound } from "@/server/http";
import { isPriceAlertType, isPriceConditionMet } from "@/lib/alerts";
import { formatPrice } from "@/lib/format";
import type { AlertDTO, AlertEvaluationResultDTO, NotificationDTO, PriceAlertType } from "@/lib/types";
import type { Alert } from "@/generated/prisma/client";
import { getQuotes } from "./instruments";
import { toInstrumentSummary, type InstrumentWithMarket } from "./mappers";

type AlertRow = Alert & { instrument: InstrumentWithMarket };

async function toDTOs(rows: AlertRow[]): Promise<AlertDTO[]> {
  const quotes = await getQuotes(rows.map((r) => r.instrumentId));
  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    threshold: a.threshold,
    status: a.status,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
    lastEvaluatedAt: a.lastEvaluatedAt?.toISOString() ?? null,
    triggeredAt: a.triggeredAt?.toISOString() ?? null,
    triggeredValue: a.triggeredValue,
    instrument: { ...toInstrumentSummary(a.instrument), quote: quotes.get(a.instrumentId) ?? null },
  }));
}

const STATUS_ORDER = { ACTIVE: 0, TRIGGERED: 1, PAUSED: 2 } as const;

export async function listAlerts(filter: { instrumentId?: string } = {}): Promise<AlertDTO[]> {
  const rows = await db.alert.findMany({
    where: filter.instrumentId ? { instrumentId: filter.instrumentId } : {},
    include: { instrument: { include: { market: true } } },
    orderBy: { createdAt: "desc" },
  });
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return toDTOs(rows);
}

export async function createAlert(input: {
  instrumentId: string;
  type: PriceAlertType;
  threshold: number;
  note?: string;
}): Promise<AlertDTO> {
  const instrument = await db.instrument.findUnique({ where: { id: input.instrumentId } });
  if (!instrument) throw notFound("Instrument");
  const row = await db.alert.create({
    data: { instrumentId: input.instrumentId, type: input.type, threshold: input.threshold, note: input.note || null },
    include: { instrument: { include: { market: true } } },
  });
  return (await toDTOs([row]))[0];
}

export async function updateAlert(
  id: string,
  patch: { status?: "ACTIVE" | "PAUSED"; threshold?: number; note?: string | null },
): Promise<AlertDTO> {
  const current = await db.alert.findUnique({ where: { id } });
  if (!current) throw notFound("Alert");
  // Re-activating (or changing the threshold of) a triggered alert re-arms it.
  const rearm = patch.status === "ACTIVE" || (patch.threshold !== undefined && current.status === "TRIGGERED");
  const row = await db.alert.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
      ...(patch.note !== undefined ? { note: patch.note || null } : {}),
      ...(rearm ? { status: patch.status ?? "ACTIVE", triggeredAt: null, triggeredValue: null } : {}),
    },
    include: { instrument: { include: { market: true } } },
  });
  return (await toDTOs([row]))[0];
}

export async function deleteAlert(id: string): Promise<void> {
  const result = await db.alert.deleteMany({ where: { id } });
  if (result.count === 0) throw notFound("Alert");
}

/**
 * Checks every ACTIVE price alert against the latest stored daily close.
 * With simulated data this demonstrates the alert pipeline; it is not a live market check.
 */
export async function evaluateAlerts(now = new Date()): Promise<AlertEvaluationResultDTO> {
  const alerts = await db.alert.findMany({
    where: { status: "ACTIVE" },
    include: { instrument: { include: { market: true } } },
  });
  const quotes = await getQuotes(alerts.map((a) => a.instrumentId));
  const result: AlertEvaluationResultDTO = { evaluated: 0, triggered: [], skipped: [], evaluatedAt: now.toISOString() };

  for (const alert of alerts) {
    if (!isPriceAlertType(alert.type)) {
      result.skipped.push({ alertId: alert.id, reason: `${alert.type} alerts are not evaluated yet` });
      continue;
    }
    const quote = quotes.get(alert.instrumentId);
    if (!quote) {
      result.skipped.push({ alertId: alert.id, reason: "No price data for instrument" });
      continue;
    }
    result.evaluated++;
    const met = isPriceConditionMet(alert.type, alert.threshold, quote.last);
    if (!met) {
      await db.alert.update({ where: { id: alert.id }, data: { lastEvaluatedAt: now } });
      continue;
    }
    const { symbol, currency, type } = alert.instrument;
    const priceText = formatPrice(quote.last, currency, type);
    const thresholdText = formatPrice(alert.threshold, currency, type);
    const dataLabel = quote.provenance.isSimulated ? "simulated close" : "close";
    await db.$transaction([
      db.alert.update({
        where: { id: alert.id },
        data: { status: "TRIGGERED", triggeredAt: now, triggeredValue: quote.last, lastEvaluatedAt: now },
      }),
      db.notification.create({
        data: {
          type: "ALERT_TRIGGERED",
          alertId: alert.id,
          title: `${symbol} is at or ${alert.type === "PRICE_ABOVE" ? "above" : "below"} ${thresholdText}`,
          body: `${symbol} ${dataLabel} on ${quote.provenance.asOfTradingDate} was ${priceText} (alert level ${thresholdText}).`,
        },
      }),
    ]);
    result.triggered.push({ alertId: alert.id, symbol, value: quote.last });
  }
  return result;
}

export async function listNotifications(limit = 20): Promise<NotificationDTO[]> {
  const rows = await db.notification.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  }));
}
