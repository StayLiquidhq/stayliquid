import { NextRequest, after } from "next/server";
import crypto from "crypto";
import supabase from "@/utils/supabase";
import { resolveIpLocation } from "@/lib/geoip";
import { logger } from "@/lib/logger";

export type AuditEventType = "login" | "signup" | "plan_create" | "plan_break" | "payout";

export interface RecordAuditParams {
  userId: string | null;
  eventType: AuditEventType;
  request?: NextRequest | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface ClientMetadata {
  ipAddress: string;
  userAgent: string;
  deviceId: string;
}

export function extractClientMetadata(request: NextRequest): ClientMetadata {
  const forwarded = request.headers.get("x-forwarded-for");

  const ipAddress = forwarded
    ? forwarded.split(",")[0].trim()
    : request.headers.get("x-real-ip") ?? "0.0.0.0";

  const userAgent = request.headers.get("user-agent") ?? "Unknown";

  const deviceId = crypto
    .createHash("sha256")
    .update(ipAddress + userAgent)
    .digest("hex");

  return { ipAddress, userAgent, deviceId };
}

export function recordAuditLog(params: RecordAuditParams): void {
  let ipAddress = params.ipAddress ?? "0.0.0.0";
  let userAgent = params.userAgent ?? "Unknown";
  let deviceId = "";

  if (params.request) {
    const meta = extractClientMetadata(params.request);
    ipAddress = meta.ipAddress;
    userAgent = meta.userAgent;
    deviceId = meta.deviceId;
  } else {
    deviceId = crypto
      .createHash("sha256")
      .update(ipAddress + userAgent)
      .digest("hex");
  }

  after(async () => {
    try {
      const location = resolveIpLocation(ipAddress);

      const { error } = await supabase.from("audit_logs").insert({
        user_id: params.userId,
        event_type: params.eventType,
        ip_address: ipAddress,
        user_agent: userAgent,
        device_id: deviceId,
        geo_location: {
          countryCode: location.countryCode,
          region: location.region,
          regionCodes: location.regionCodes,
        },
      });

      if (error) {
        logger.error("Failed to insert audit log entry", {
          module: "audit",
          eventType: params.eventType,
          userId: params.userId,
        }, error);
      } else {
        logger.debug("Successfully recorded audit log entry", {
          module: "audit",
          eventType: params.eventType,
          userId: params.userId,
        });
      }
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      logger.error("Unexpected error in audit log worker", {
        module: "audit",
        eventType: params.eventType,
      }, errorObj);
    }
  });
}
