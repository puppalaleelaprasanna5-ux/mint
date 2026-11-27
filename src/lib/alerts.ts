/** Pure alert rules (unit-tested). Phase 1 evaluates price-level alerts only. */

export type PriceAlertKind = "PRICE_ABOVE" | "PRICE_BELOW";

export function isPriceAlertType(type: string): type is PriceAlertKind {
  return type === "PRICE_ABOVE" || type === "PRICE_BELOW";
}

/** True when `price` satisfies the alert (inclusive of the threshold). */
export function isPriceConditionMet(type: PriceAlertKind, threshold: number, price: number): boolean {
  return type === "PRICE_ABOVE" ? price >= threshold : price <= threshold;
}

/** Signed % distance from the current price to the threshold (positive = threshold above price). */
export function distanceToThresholdPercent(price: number, threshold: number): number | null {
  if (price === 0) return null;
  return ((threshold - price) / price) * 100;
}

export function describeAlert(type: string, threshold: string): string {
  switch (type) {
    case "PRICE_ABOVE":
      return `Price rises to ${threshold} or higher`;
    case "PRICE_BELOW":
      return `Price falls to ${threshold} or lower`;
    default:
      return `${type} at ${threshold}`;
  }
}
