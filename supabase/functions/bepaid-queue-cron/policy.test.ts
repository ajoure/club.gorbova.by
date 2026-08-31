import { assertEquals } from "jsr:@std/assert";
import {
  isStaleProcessingItem,
  normalizeQueueRunOptions,
  staleProcessingCutoff,
} from "./policy.ts";

Deno.test("queue cron bounds caller-controlled batch options", () => {
  assertEquals(
    normalizeQueueRunOptions({
      queueItemId: "  row-id  ",
      maxAttempts: 999,
      batchSize: 999,
      excludeFileImport: false,
    }),
    {
      dryRun: false,
      queueItemId: "row-id",
      maxAttempts: 10,
      batchSize: 50,
      excludeFileImport: false,
      excludeCancelled: true,
    },
  );
});

Deno.test("queue cron uses safe defaults for malformed options", () => {
  assertEquals(
    normalizeQueueRunOptions({ maxAttempts: "5", batchSize: 0 }),
    {
      dryRun: false,
      queueItemId: null,
      maxAttempts: 5,
      batchSize: 1,
      excludeFileImport: true,
      excludeCancelled: true,
    },
  );
});

Deno.test("only processing rows older than two hours are stale", () => {
  const now = new Date("2026-08-29T10:00:00.000Z");
  const cutoff = staleProcessingCutoff(now);
  assertEquals(cutoff, "2026-08-29T08:00:00.000Z");
  assertEquals(
    isStaleProcessingItem(
      { status: "processing", updated_at: "2026-08-29T07:59:59.999Z" },
      cutoff,
    ),
    true,
  );
  assertEquals(
    isStaleProcessingItem(
      { status: "processing", updated_at: "2026-08-29T08:00:00.000Z" },
      cutoff,
    ),
    false,
  );
  assertEquals(
    isStaleProcessingItem(
      { status: "pending", updated_at: "2026-08-29T07:00:00.000Z" },
      cutoff,
    ),
    false,
  );
});
