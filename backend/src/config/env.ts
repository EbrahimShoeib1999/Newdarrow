import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Environment contract for the D-Arrow backend (Phase 2 / T2.1).
 *
 * Rules:
 * - Every variable the backend reads is declared here — nothing else reads process.env directly.
 * - Validation fails fast at boot with a human-readable list of all problems (no half-configured startup).
 * - A local `.env` file (gitignored, see `.env.example`) is loaded if present; real environment
 *   variables always win. Empty real-env values are treated as unset (Windows habit), while an
 *   empty value passed directly to `parseEnv` is an error (empty means misconfigured, not unset).
 */

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Required from Phase 2 task T2.2 onward; intentionally optional in T2.1 (the scaffold boots without a database). */
  DATABASE_URL: z.string().min(1).optional(),

  /** JWT access token secret (required from Phase 3 / auth bridge). */
  JWT_SECRET: z.string().min(1).default("dev-secret-change-in-production"),

  /** JWT refresh token secret (required from Phase 3 / auth bridge). */
  JWT_REFRESH_SECRET: z.string().min(1).default("dev-refresh-secret-change-in-production"),

  /** Access token TTL in seconds (default 15 minutes). */
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  /** Refresh token TTL in seconds (default 7 days). */
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  /** Rate limiting: max requests per window for auth endpoints. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  /** Rate limiting: window duration in seconds. */
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  /** Allowed CORS origins (comma-separated). Empty = no CORS (same-origin only). */
  CORS_ALLOWED_ORIGINS: z.string().default(""),

  /** Whether CORS credentials are allowed. */
  CORS_CREDENTIALS: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string) {
    super(`Invalid environment configuration:\n${issues}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("\n");
  throw new EnvValidationError(issues);
}

function readEnvFile(filePath = resolve(process.cwd(), ".env")): Record<string, string> {
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    const vars: Record<string, string> = {};
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        continue;
      }
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      if (!key) {
        continue;
      }
      const value =
        rawValue.length >= 2 &&
        ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'")))
          ? rawValue.slice(1, -1)
          : rawValue;
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

/**
 * Loads and validates the environment.
 * Throws `EnvValidationError` (so boot failures are testable); with `failFast = true`
 * the process instead logs the problems and exits non-zero immediately.
 */
export function loadEnv(failFast = false): Env {
  const fileVars = readEnvFile();
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const processValue = process.env[key];
    raw[key] = processValue !== undefined && processValue !== "" ? processValue : fileVars[key];
  }
  try {
    return parseEnv(raw);
  } catch (error) {
    if (failFast) {
      console.error(`[env] ${(error as EnvValidationError).message}`);
      process.exit(1);
    }
    throw error;
  }
}
