import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { resolveRequestId } from "../request-id";

/**
 * Maps every error to the frontend's `ApiError` contract exactly:
 *   { message: string; statusCode: number; errors?: Record<string, string[]> }
 *
 * (Frontend source of truth: `src/types/api.types.ts`. Design doc 01 sketched a
 * `{ success, error: { code, message, details } }` shape from an inaccurate description
 * of that file — the implemented contract follows the real types; see the Phase 2 report,
 * erratum 2.)
 *
 * Non-HttpException errors become a bare 500: internal details are logged server-side
 * and never leaked to the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = resolveRequestId(request, response);

    const httpException =
      exception instanceof HttpException
        ? exception
        : new HttpException("Internal server error", HttpStatus.INTERNAL_SERVER_ERROR);

    const status = httpException.getStatus();

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.originalUrl} id=${requestId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body = httpException.getResponse();

    let message: string;
    let errors: Record<string, string[]> | undefined;

    if (typeof body === "string") {
      message = body;
    } else if (body && typeof body === "object") {
      const record = body as { message?: unknown; error?: unknown; errors?: unknown };
      if (Array.isArray(record.message)) {
        // ValidationPipe failures arrive as an array of messages — joined for the client.
        const messages = record.message.map((item) => String(item));
        message = messages.join("; ");
      } else if (typeof record.message === "string") {
        message = record.message;
      } else if (typeof record.error === "string") {
        message = record.error;
      } else {
        message = httpException.message || "Internal server error";
      }
      if (
        record.errors &&
        typeof record.errors === "object" &&
        !Array.isArray(record.errors) &&
        Object.values(record.errors).every((value) => Array.isArray(value))
      ) {
        errors = record.errors as Record<string, string[]>;
      }
    } else {
      message = httpException.message || "Internal server error";
    }

    response.status(status).json({
      message,
      statusCode: status,
      ...(errors ? { errors } : {}),
    });
  }
}
