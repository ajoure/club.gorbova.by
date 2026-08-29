import { describe, expect, it } from "vitest";
import { authorizeQueueCronRequest } from "../../supabase/functions/bepaid-queue-cron/auth";
import {
  isStaleProcessingItem,
  normalizeQueueRunOptions,
  staleProcessingCutoff,
} from "../../supabase/functions/bepaid-queue-cron/policy";

describe("bePaid queue cron authorization", () => {
  const secrets = {
    serviceRoleKey: "service-role-test-key",
    cronSecret: "cron-test-key",
  };

  it("allows only the exact managed service or cron credential", () => {
    expect(authorizeQueueCronRequest(
      new Request("https://example.test", {
        headers: { apikey: secrets.serviceRoleKey },
      }),
      secrets,
    )).toEqual({ ok: true, mode: "service_role" });

    expect(authorizeQueueCronRequest(
      new Request("https://example.test", {
        headers: { "x-cron-secret": secrets.cronSecret },
      }),
      secrets,
    )).toEqual({ ok: true, mode: "cron_secret" });

    expect(authorizeQueueCronRequest(
      new Request("https://example.test", {
        headers: { authorization: "Bearer ordinary-user-jwt" },
      }),
      secrets,
    )).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });
});

describe("bePaid stale processing recovery policy", () => {
  it("bounds all caller-controlled run options", () => {
    expect(normalizeQueueRunOptions({
      queueItemId: "  row-id  ",
      maxAttempts: 999,
      batchSize: 999,
      excludeFileImport: false,
    })).toEqual({
      queueItemId: "row-id",
      maxAttempts: 10,
      batchSize: 50,
      excludeFileImport: false,
      excludeCancelled: true,
    });
  });

  it("recovers only processing rows older than two hours", () => {
    const cutoff = staleProcessingCutoff(
      new Date("2026-08-29T10:00:00.000Z"),
    );
    expect(cutoff).toBe("2026-08-29T08:00:00.000Z");
    expect(isStaleProcessingItem({
      status: "processing",
      updated_at: "2026-08-29T07:59:59.999Z",
    }, cutoff)).toBe(true);
    expect(isStaleProcessingItem({
      status: "processing",
      updated_at: "2026-08-29T08:00:00.000Z",
    }, cutoff)).toBe(false);
    expect(isStaleProcessingItem({
      status: "pending",
      updated_at: "2026-08-29T07:00:00.000Z",
    }, cutoff)).toBe(false);
  });
});
