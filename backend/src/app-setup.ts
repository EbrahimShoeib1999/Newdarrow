import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { loadEnv } from "./config/env";

/**
 * Runtime conventions applied identically in production (main.ts) and tests (e2e specs) —
 * one place defines the API surface so test behavior cannot drift from production behavior.
 *
 * Pipeline order (doc 01 §4): validation → [auth → tenant → permissions → entitlement arrive
 * in later phases] → response envelope. Interceptor order: logging is registered first
 * (outermost) so it observes the final status and request id; the envelope wraps the payload.
 */
export function configureApp(app: INestApplication): void {
  const env = loadEnv();

  // CORS — environment-driven, never wildcard with credentials
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: env.CORS_CREDENTIALS && allowedOrigins.length > 0,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400, // 24 hours
  });

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
