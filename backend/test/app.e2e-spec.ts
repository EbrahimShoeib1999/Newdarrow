import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app-setup";
import { bootstrap } from "../src/main";
import { EnvValidationError } from "../src/config/env";

/**
 * T2.1 e2e — the scaffold's runtime conventions, exercised through the same
 * `configureApp` used in production (main.ts), via supertest (no real port binding).
 */
describe("D-Arrow API (e2e) — T2.1 conventions", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health → 200 with the ApiResponse envelope { data, message }", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body).toEqual({
      data: {
        status: "ok",
        uptimeSeconds: expect.any(Number),
        timestamp: expect.any(String),
      },
      message: "ok",
    });
  });

  it("GET /api/v1/health echoes a client-supplied x-request-id", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health").set("x-request-id", "e2e-42");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("e2e-42");
  });

  it("GET /api/v1/does-not-exist → 404 with the ApiError envelope { message, statusCode }", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.statusCode).toBe(404);
    expect(typeof response.body.message).toBe("string");
    expect(response.body.message).toContain("does-not-exist");
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });
});

describe("bootstrap (e2e) — fail fast on a poisoned environment", () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it("rejects with EnvValidationError before the server binds when PORT is invalid", async () => {
    process.env.PORT = "not-a-port";
    await expect(bootstrap()).rejects.toBeInstanceOf(EnvValidationError);
  });
});
