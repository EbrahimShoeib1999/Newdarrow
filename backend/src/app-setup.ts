import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";

/**
 * Runtime conventions applied identically in production (main.ts) and tests (e2e specs) —
 * one place defines the API surface so test behavior cannot drift from production behavior.
 *
 * Pipeline order (doc 01 §4): validation → [auth → tenant → permissions → entitlement arrive
 * in later phases] → response envelope. Interceptor order: logging is registered first
 * (outermost) so it observes the final status and request id; the envelope wraps the payload.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseEnvelopeInterceptor());
  app.enableShutdownHooks();
}
