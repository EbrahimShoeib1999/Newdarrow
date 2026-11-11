import { Global, Module } from "@nestjs/common";
import { loadEnv, type Env } from "./env";

export const ENV_TOKEN = "ENV_TOKEN";

/**
 * Global config module: validates the environment once at composition time and
 * exposes the parsed result via ENV_TOKEN. Consumers inject Env — they never read
 * process.env directly (single validation point, fail-fast at boot).
 */
@Global()
@Module({
  providers: [{ provide: ENV_TOKEN, useFactory: (): Env => loadEnv() }],
  exports: [ENV_TOKEN],
})
export class ConfigModule {}
