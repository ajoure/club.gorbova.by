export const STALE_PROCESSING_MS = 2 * 60 * 60 * 1000;

export interface QueueRunOptions {
  queueItemId: string | null;
  maxAttempts: number;
  batchSize: number;
  excludeFileImport: boolean;
  excludeCancelled: boolean;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function normalizeQueueRunOptions(
  body: Record<string, unknown>,
): QueueRunOptions {
  const rawQueueItemId = typeof body.queueItemId === "string"
    ? body.queueItemId.trim()
    : "";

  return {
    queueItemId: rawQueueItemId || null,
    maxAttempts: boundedInteger(body.maxAttempts, 5, 1, 10),
    batchSize: boundedInteger(body.batchSize, 20, 1, 50),
    excludeFileImport: body.excludeFileImport !== false,
    excludeCancelled: body.excludeCancelled !== false,
  };
}

export function staleProcessingCutoff(now: Date): string {
  return new Date(now.getTime() - STALE_PROCESSING_MS).toISOString();
}

export function isStaleProcessingItem(
  item: { status?: string | null; updated_at?: string | null },
  cutoffIso: string,
): boolean {
  if (item.status !== "processing" || !item.updated_at) return false;
  const updatedAt = Date.parse(item.updated_at);
  const cutoff = Date.parse(cutoffIso);
  return Number.isFinite(updatedAt) && Number.isFinite(cutoff) &&
    updatedAt < cutoff;
}
