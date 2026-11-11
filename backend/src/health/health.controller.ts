import { Controller, Get } from "@nestjs/common";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

@Controller("health")
export class HealthController {
  /**
   * Liveness check — deliberately dependency-free (no DB call) until T2.2 adds a readiness probe.
   * GET /api/v1/health → { data: { status, uptimeSeconds, timestamp }, message: "ok" }
   */
  @Get()
  @ResponseMessage("ok")
  check(): { status: "ok"; uptimeSeconds: number; timestamp: string } {
    return {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
