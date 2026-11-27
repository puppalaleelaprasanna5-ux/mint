import { ProviderError, type ProviderErrorKind, type ProviderId } from "@/lib/market-data/types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 20_000;

function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "INVALID_REQUEST";
}

/**
 * GET JSON with a timeout. Non-2xx responses become ProviderError with a short, credential-free
 * message built by `describeError` from the response body.
 */
export async function getJson(
  provider: ProviderId,
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  describeError: (status: number, body: unknown) => string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ProviderError(provider, "NETWORK", timedOut ? "Request timed out" : "Network error contacting provider");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ProviderError(provider, kindForStatus(res.status), describeError(res.status, body), res.status);
  }
  if (body === null) {
    throw new ProviderError(provider, "BAD_RESPONSE", "Provider returned a non-JSON response", res.status);
  }
  return body;
}

/** Trim provider-supplied text before storing/showing it. */
export function clip(text: unknown, max = 200): string {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
