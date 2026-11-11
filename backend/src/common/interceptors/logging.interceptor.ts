import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { resolveRequestId } from "../request-id";

/**
 * Request logging with a propagated `x-request-id`:
 * - echoes the client-supplied id when present, otherwise generates one (uuid v4)
 * - the id is attached to the response header and included in the log line
 * - the header is set during the request phase, so it is present on error responses
 *   routed through a controller; unrouted requests (404 before any interceptor) are
 *   covered by the exception filter, which calls the same `resolveRequestId`
 *   (the filter logs failures; this interceptor logs successful outcomes)
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const requestId = resolveRequestId(request, response);

    const method = request.method;
    const url = request.originalUrl ?? request.url;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.log(`${method} ${url} ${response.statusCode} ${Date.now() - startedAt}ms id=${requestId}`);
      }),
    );
  }
}
