import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

/**
 * Resolves the request id for the current request: echoes the client-supplied
 * `x-request-id` when present, otherwise generates a uuid v4. Attaches it to
 * the response header (guarded against already-sent headers) and back onto the
 * request object so both the logging interceptor and the exception filter —
 * which runs for unrouted requests where no interceptor executes — agree on it.
 */
export function resolveRequestId(request: Request, response: Response): string {
  const incoming = request.headers["x-request-id"];
  const requestId = typeof incoming === "string" && incoming.length > 0 ? incoming : randomUUID();
  request.headers["x-request-id"] = requestId;
  if (!response.headersSent) {
    response.setHeader("x-request-id", requestId);
  }
  return requestId;
}
