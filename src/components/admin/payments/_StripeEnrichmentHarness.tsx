/**
 * TEMPORARY HARNESS — PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 / F2-F3 runtime gate
 *
 * Назначение: одноразовое выполнение admin-only runtime proof (dry-run, execute, idempotency)
 * через текущую авторизованную браузерную Supabase-сессию. Используется ТОЛЬКО для сбора
 * proof в рамках указанного патча. После сбора proof файл и его mount удаляются в этом же
 * патче. В production-визуальное состояние UI не входит.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRbac } from "@/hooks/useRbac";

type CallKey = "dry_run" | "execute_1" | "execute_2";

const PAYLOAD = {
  account_code: "stripe_poland",
  limit: 50,
  force_refresh: false as const,
};

export function StripeEnrichmentHarness() {
  const { isSuperAdmin, loading } = useRbac();
  const [results, setResults] = useState<Record<CallKey, unknown>>({} as Record<CallKey, unknown>);
  const [busy, setBusy] = useState<CallKey | null>(null);

  if (loading || !isSuperAdmin) return null;

  const run = async (key: CallKey, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const startedAt = new Date().toISOString();
      const { data, error } = await supabase.functions.invoke(
        "stripe-card-data-fetch-bulk",
        { body }
      );
      const finishedAt = new Date().toISOString();
      const payload = { startedAt, finishedAt, request: body, data, error: error?.message ?? null };
      setResults((prev) => ({ ...prev, [key]: payload }));
      // eslint-disable-next-line no-console
      console.log(`[stripe-enrichment-harness] ${key}`, payload);
    } catch (e) {
      setResults((prev) => ({ ...prev, [key]: { error: String(e) } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-50/40 p-3 text-xs space-y-2">
      <div className="font-semibold text-amber-900">
        Temporary: Stripe Card Enrichment Runtime Harness (PATCH-V2)
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run("dry_run", { ...PAYLOAD, dry_run: true })}
        >
          {busy === "dry_run" ? "..." : "1. Dry-run"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !results.dry_run}
          onClick={() => run("execute_1", { ...PAYLOAD, dry_run: false })}
        >
          {busy === "execute_1" ? "..." : "2. Execute #1"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !results.execute_1}
          onClick={() => run("execute_2", { ...PAYLOAD, dry_run: false })}
        >
          {busy === "execute_2" ? "..." : "3. Execute #2 (idempotency)"}
        </Button>
      </div>
      {(["dry_run", "execute_1", "execute_2"] as CallKey[]).map((k) =>
        results[k] ? (
          <pre
            key={k}
            data-harness-key={k}
            className="max-h-64 overflow-auto rounded bg-background/80 p-2 text-[10px] leading-tight"
          >
            {JSON.stringify(results[k], null, 2)}
          </pre>
        ) : null
      )}
    </div>
  );
}
