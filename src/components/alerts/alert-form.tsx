"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellPlus, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { distanceToThresholdPercent } from "@/lib/alerts";
import { formatPercent, formatPrice } from "@/lib/format";
import type { InstrumentWithQuoteDTO, PriceAlertType } from "@/lib/types";
import { buttonStyles, inputStyles } from "@/components/ui";

/**
 * Create a price alert. Pass a single `instruments` entry to lock the instrument
 * (instrument page), or several to show a picker (alerts page).
 */
export function AlertForm({ instruments }: { instruments: InstrumentWithQuoteDTO[] }) {
  const router = useRouter();
  const [instrumentId, setInstrumentId] = useState(instruments[0]?.id ?? "");
  const [type, setType] = useState<PriceAlertType>("PRICE_ABOVE");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const instrument = instruments.find((i) => i.id === instrumentId);
  const last = instrument?.quote?.last;
  const thresholdNum = Number(threshold);
  const distance = last && thresholdNum > 0 ? distanceToThresholdPercent(last, thresholdNum) : null;
  const alreadyMet =
    last != null && thresholdNum > 0 && (type === "PRICE_ABOVE" ? last >= thresholdNum : last <= thresholdNum);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api("/api/alerts", {
        method: "POST",
        json: { instrumentId, type, threshold: thresholdNum, note: note.trim() || undefined },
      });
      setThreshold("");
      setNote("");
      setMessage({ kind: "ok", text: "Alert saved." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const regions = [
    { label: "India", items: instruments.filter((i) => i.market.region === "IN") },
    { label: "US", items: instruments.filter((i) => i.market.region === "US") },
  ];

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {instruments.length > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Stock or index
          <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} className={inputStyles} required>
            {regions.map((r) =>
              r.items.length ? (
                <optgroup key={r.label} label={r.label}>
                  {r.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.symbol} — {i.name} ({i.market.code})
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
        </label>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Notify me when price
          <select value={type} onChange={(e) => setType(e.target.value as PriceAlertType)} className={inputStyles}>
            <option value="PRICE_ABOVE">rises to or above</option>
            <option value="PRICE_BELOW">falls to or below</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Price level ({instrument?.type === "INDEX" ? "points" : instrument?.currency})
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder={last ? last.toFixed(2) : "0.00"}
            className={inputStyles}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Note (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Why does this level matter to you?"
          className={inputStyles}
        />
      </label>

      {instrument && last != null ? (
        <p className="text-xs text-subtle">
          Latest close: {formatPrice(last, instrument.currency, instrument.type)}
          {instrument.quote?.provenance.isSimulated ? " (simulated)" : ""}
          {distance != null ? ` · level is ${formatPercent(distance)} away` : ""}
          {alreadyMet ? " · this level is already reached, so the alert will trigger on the next check." : ""}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" className={buttonStyles.primary} disabled={saving || !instrumentId || !(thresholdNum > 0)}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <BellPlus className="size-4" />}
          Create alert
        </button>
        {message ? (
          <span role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "ok" ? "text-up" : "text-down"}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
