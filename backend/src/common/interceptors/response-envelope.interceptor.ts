import "reflect-metadata";
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map, Observable } from "rxjs";
import { RESPONSE_MESSAGE_KEY } from "../decorators/response-message.decorator";

/**
 * Wraps every successful handler result in the frontend's ApiResponse contract:
 *   { data: <payload>, message: <string> }
 *
 * - the handler's return value becomes `data` (undefined becomes null so the field is always present)
 * - `message` comes from `@ResponseMessage()` on the route handler, defaulting to "OK"
 * - paginated endpoints return `PaginatedResponse<T>` as their payload — it rides inside `data`
 *   unchanged (`ApiResponse<PaginatedResponse<T>>` on the wire)
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<{ data: unknown; message: string }> {
    const handler = context.getHandler();
    const message = (Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handler) as string | undefined) ?? "OK";
    return next.handle().pipe(
      map((data) => ({
        data: data === undefined ? null : data,
        message,
      })),
    );
  }
}
