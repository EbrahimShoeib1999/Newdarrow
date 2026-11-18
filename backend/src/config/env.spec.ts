import { EnvValidationError, parseEnv } from "./env";

describe("parseEnv (T2.1 — config validation)", () => {
  it("applies documented defaults when nothing is set", () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      DATABASE_URL: undefined,
      JWT_SECRET: "dev-secret-change-in-production",
      JWT_REFRESH_SECRET: "dev-refresh-secret-change-in-production",
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_REFRESH_TTL_SECONDS: 604800,
      RATE_LIMIT_MAX: 10,
      RATE_LIMIT_WINDOW_SECONDS: 60,
      CORS_ALLOWED_ORIGINS: "",
      CORS_CREDENTIALS: true,
    });
  });

  it("coerces PORT from a numeric string", () => {
    expect(parseEnv({ PORT: "3005" }).PORT).toBe(3005);
  });

  it("accepts every declared NODE_ENV value", () => {
    for (const nodeEnv of ["development", "test", "production"] as const) {
      expect(parseEnv({ NODE_ENV: nodeEnv }).NODE_ENV).toBe(nodeEnv);
    }
  });

  it("accepts an optional DATABASE_URL", () => {
    expect(parseEnv({ DATABASE_URL: "postgresql://localhost:5433/darrow" }).DATABASE_URL).toBe(
      "postgresql://localhost:5433/darrow",
    );
  });

  it("rejects an empty DATABASE_URL (empty means misconfigured, not unset)", () => {
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrow(EnvValidationError);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => parseEnv({ PORT: "not-a-port" })).toThrow(EnvValidationError);
  });

  it("rejects out-of-range ports", () => {
    expect(() => parseEnv({ PORT: "0" })).toThrow(EnvValidationError);
    expect(() => parseEnv({ PORT: "65536" })).toThrow(EnvValidationError);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow(EnvValidationError);
  });

  it("collects every issue into one failure message", () => {
    try {
      parseEnv({ NODE_ENV: "staging", PORT: "http" });
      throw new Error("expected parseEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues).toContain("NODE_ENV");
      expect(issues).toContain("PORT");
    }
  });
});
