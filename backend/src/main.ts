import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app-setup";
import { loadEnv } from "./config/env";
import { config as dotenvConfig } from "dotenv";

// Load .env file into process.env before anything else reads it
dotenvConfig();

/**
 * Exported so tests can assert boot failures (an invalid environment rejects before the
 * server binds a port). The `require.main` guard keeps this module importable without
 * side effects; the guard converts any boot failure into a non-zero exit (fail fast).
 */
export async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(env.PORT);
  console.log(`[boot] D-Arrow API listening on http://localhost:${env.PORT}/api/v1 (NODE_ENV=${env.NODE_ENV})`);
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    console.error(`[boot] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
