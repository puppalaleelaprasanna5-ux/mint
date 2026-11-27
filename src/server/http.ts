import "server-only";
import { connection } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ApiErrorBody } from "@/lib/types";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string) => new HttpError(409, "CONFLICT", message);
export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "BAD_REQUEST", message, details);

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

function errorResponse(status: number, body: ApiErrorBody): Response {
  return Response.json(body, { status });
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return errorResponse(err.status, { error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return errorResponse(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: err.issues[0]?.message ?? "Invalid input",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return errorResponse(409, { error: { code: "CONFLICT", message: "A record with these values already exists" } });
    }
    if (err.code === "P2025") {
      return errorResponse(404, { error: { code: "NOT_FOUND", message: "Record not found" } });
    }
  }
  console.error("[api] unhandled error", err);
  return errorResponse(500, { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}

/**
 * Wraps a route handler: opts it out of prerendering (the SQLite driver is synchronous, see
 * Next.js `connection()` docs) and converts thrown errors into JSON error responses.
 */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    // Outside the try: during prerendering this suspends and must not be caught.
    await connection();
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Reads and parses a JSON body; malformed JSON becomes a 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}
