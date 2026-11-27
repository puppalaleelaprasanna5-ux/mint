/** Relevance ranking for instrument search (pure, unit-tested). Lower score = better match. */
export function searchScore(query: string, symbol: string, name: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 100;
  const s = symbol.toLowerCase();
  const n = name.toLowerCase();
  if (s === q) return 0;
  if (s.startsWith(q)) return 1;
  if (n.startsWith(q)) return 2;
  if (n.split(/[\s().&-]+/).some((word) => word.startsWith(q))) return 3;
  if (s.includes(q)) return 4;
  if (n.includes(q)) return 5;
  return null;
}

export function rankBySearch<T extends { symbol: string; name: string }>(items: T[], query: string): T[] {
  return items
    .map((item) => ({ item, score: searchScore(query, item.symbol, item.name) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.item.symbol.localeCompare(b.item.symbol))
    .map((x) => x.item);
}
