import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authorizeQueueCronRequest } from "../../supabase/functions/bepaid-queue-cron/auth";
import {
  isStaleProcessingItem,
  normalizeQueueRunOptions,
  staleProcessingCutoff,
  staleTerminalReason,
} from "../../supabase/functions/_shared/bepaid-queue-policy";

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
  it("releases exhausted and excluded stale claims without replaying them", () => {
    const source = readFileSync("supabase/functions/bepaid-queue-cron/index.ts", "utf8");
    expect(source).toContain("status.in.(pending,error),attempts.lt.${maxAttempts}");
    expect(source).toContain("and(status.eq.processing,updated_at.lt.${processingCutoff})");
    expect(source).not.toContain('.lt("attempts", maxAttempts)');
    expect(source).toContain("staleTerminalReason(item,");
    expect(source).toContain('supabase.functions.invoke("payments-reconcile"');
    expect(source).toContain('expectedUpdatedAt: item.updated_at');
    expect(source).not.toContain('.update(');
  });
  it("bounds all caller-controlled run options", () => {
    expect(normalizeQueueRunOptions({
      queueItemId: "  row-id  ",
      maxAttempts: 999,
      batchSize: 999,
      excludeFileImport: false,
    })).toEqual({
      dryRun: false,
      queueItemId: "row-id",
      maxAttempts: 10,
      batchSize: 50,
      excludeFileImport: false,
      excludeCancelled: true,
    });
  });

  it("previews both dry-run spellings before any queue mutation or worker call", () => {
    expect(normalizeQueueRunOptions({ dry_run: true }).dryRun).toBe(true);
    expect(normalizeQueueRunOptions({ dryRun: true }).dryRun).toBe(true);
    expect(normalizeQueueRunOptions({ dry_run: "true" }).dryRun).toBe(false);
    const source = readFileSync("supabase/functions/bepaid-queue-cron/index.ts", "utf8");
    expect(source).not.toContain(".update(");
    expect(source.indexOf("if (dryRun)")).toBeLessThan(source.indexOf("supabase.functions.invoke("));
  });

  it("never replays exhausted, cancelled or excluded stale items", () => {
    const options = normalizeQueueRunOptions({});
    expect(staleTerminalReason({ attempts: 5 }, options)).toBe("STALE_PROCESSING_MAX_ATTEMPTS");
    expect(staleTerminalReason({ attempts: 6 }, options)).toBe("STALE_PROCESSING_MAX_ATTEMPTS");
    expect(staleTerminalReason({ attempts: 4 }, options)).toBeNull();
    expect(staleTerminalReason({ last_error: "SOFT_CANCELLED: operator" }, options)).toBe("STALE_PROCESSING_CANCELLED");
    expect(staleTerminalReason({ source: "file_import" }, options)).toBe("STALE_PROCESSING_EXCLUDED_IMPORT");
    expect(staleTerminalReason({ source: "file_import" }, { ...options, queueItemId: "exact" })).toBeNull();
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
