/**
 * useGrpRefresh — refresh MNS registry data (grp_* fields) for existing legal entities.
 *
 * Single refresh: updates one entity's grp_* fields via grp-lookup edge function.
 * Bulk refresh: iterates entities missing/stale grp data with rate limiting.
 *
 * Rules:
 * - Only grp_* fields are updated, never core entity fields (name/address/form).
 * - Idempotent: re-running on fresh records is a no-op (skipped).
 * - Audit: logs old/new snapshot + actor + source.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GrpLookupAdapter } from "@/lib/legal-entities/adapters/GrpLookupAdapter";
import { normalizeAndValidateUnp } from "@/lib/legal-entities/normalizeUnp";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import type { LegalEntityLookupResult } from "@/lib/legal-entities/types";

/** Stale threshold: 30 days */
const STALE_DAYS = 30;

function isStaleOrMissing(entity: ClientLegalDetails): boolean {
  if (!entity.grp_last_fetched_at) return true;
  const fetched = new Date(entity.grp_last_fetched_at);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - STALE_DAYS);
  return fetched < threshold;
}

function getEntityUnp(entity: ClientLegalDetails): string | null {
  const raw = entity.client_type === "entrepreneur" ? entity.ent_unp : entity.leg_unp;
  return raw ? normalizeAndValidateUnp(raw) : null;
}

function buildGrpUpdateFields(result: LegalEntityLookupResult) {
  if (!result.found || !result.data) return null;
  const d = result.data;
  return {
    grp_registration_date: d.registration_date || null,
    grp_status_code: d.status_code || null,
    grp_status_name: d.status_name || null,
    grp_tax_office_code: d.tax_office_code || null,
    grp_tax_office_name: d.tax_office_name || null,
    grp_short_name: d.short_name || null,
    grp_liquidation_date: d.liquidation_date || null,
    grp_liquidation_reason: d.liquidation_reason || null,
    grp_last_fetched_at: new Date().toISOString(),
  };
}

export interface BulkDryRunResult {
  total: number;
  withUnp: number;
  missingGrp: number;
  stale: number;
  toUpdate: number;
  candidates: ClientLegalDetails[];
}

export interface BulkRefreshResult {
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export function useGrpRefresh() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  /** Single entity refresh */
  const refreshSingle = useCallback(async (entity: ClientLegalDetails): Promise<boolean> => {
    const unp = getEntityUnp(entity);
    if (!unp) {
      toast.error("У записи нет УНП для поиска");
      return false;
    }

    setIsRefreshing(true);
    try {
      // Snapshot old values for audit
      const oldSnapshot = {
        grp_registration_date: entity.grp_registration_date,
        grp_status_name: entity.grp_status_name,
        grp_tax_office_name: entity.grp_tax_office_name,
        grp_last_fetched_at: entity.grp_last_fetched_at,
      };

      const { data, error } = await supabase.functions.invoke("grp-lookup", {
        body: { unp },
      });

      if (error) {
        toast.error("Ошибка запроса к реестру: " + error.message);
        return false;
      }

      const result = GrpLookupAdapter.mapResponse(data);
      if (!result.found) {
        toast.error("Плательщик не найден в реестре МНС");
        return false;
      }

      const fields = buildGrpUpdateFields(result);
      if (!fields) return false;

      const { error: updateError } = await supabase
        .from("client_legal_details")
        .update(fields)
        .eq("id", entity.id);

      if (updateError) {
        toast.error("Ошибка обновления: " + updateError.message);
        return false;
      }

      // Audit log (best-effort, non-blocking)
      supabase.from("audit_logs").insert({
        action: "grp_refresh",
        actor_type: "user",
        meta: {
          entity_id: entity.id,
          unp,
          source: "manual_refresh",
          old_snapshot: oldSnapshot,
          new_snapshot: {
            grp_status_name: fields.grp_status_name,
            grp_registration_date: fields.grp_registration_date,
            grp_tax_office_name: fields.grp_tax_office_name,
          },
        },
      }).then(() => {});

      queryClient.invalidateQueries({ queryKey: ["ai-entities"] });
      toast.success("Данные реестра обновлены");
      return true;
    } catch (err) {
      toast.error("Ошибка: " + (err as Error).message);
      return false;
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  /** Bulk dry-run: count candidates without executing */
  const bulkDryRun = useCallback((entities: ClientLegalDetails[]): BulkDryRunResult => {
    const withUnp = entities.filter((e) => !!getEntityUnp(e));
    const missingGrp = withUnp.filter((e) => !e.grp_last_fetched_at);
    const stale = withUnp.filter((e) => e.grp_last_fetched_at && isStaleOrMissing(e));
    const candidates = withUnp.filter((e) => isStaleOrMissing(e));

    return {
      total: entities.length,
      withUnp: withUnp.length,
      missingGrp: missingGrp.length,
      stale: stale.length - missingGrp.length, // stale but not missing
      toUpdate: candidates.length,
      candidates,
    };
  }, []);

  /** Bulk execute: refresh all candidates with rate limiting */
  const bulkExecute = useCallback(async (candidates: ClientLegalDetails[]): Promise<BulkRefreshResult> => {
    setIsBulkRunning(true);
    setBulkProgress({ current: 0, total: candidates.length });

    const result: BulkRefreshResult = { updated: 0, skipped: 0, failed: 0, errors: [] };
    const MAX_CONSECUTIVE_ERRORS = 3;
    let consecutiveErrors = 0;

    for (let i = 0; i < candidates.length; i++) {
      const entity = candidates[i];
      setBulkProgress({ current: i + 1, total: candidates.length });

      // Stop after N consecutive errors
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        result.errors.push(`Остановлено после ${MAX_CONSECUTIVE_ERRORS} ошибок подряд`);
        result.skipped += candidates.length - i;
        break;
      }

      const unp = getEntityUnp(entity);
      if (!unp) {
        result.skipped++;
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke("grp-lookup", {
          body: { unp },
        });

        if (error) {
          result.failed++;
          consecutiveErrors++;
          result.errors.push(`${unp}: ${error.message}`);
          continue;
        }

        const lookupResult = GrpLookupAdapter.mapResponse(data);
        if (!lookupResult.found) {
          result.skipped++;
          consecutiveErrors = 0;
          continue;
        }

        const fields = buildGrpUpdateFields(lookupResult);
        if (!fields) {
          result.skipped++;
          continue;
        }

        const { error: updateError } = await supabase
          .from("client_legal_details")
          .update(fields)
          .eq("id", entity.id);

        if (updateError) {
          result.failed++;
          consecutiveErrors++;
          result.errors.push(`${unp}: ${updateError.message}`);
          continue;
        }

        // Audit (best-effort)
        supabase.from("audit_logs").insert({
          action: "grp_refresh",
          actor_type: "user",
          meta: {
            entity_id: entity.id,
            unp,
            source: "bulk_refresh",
          },
        }).then(() => {});

        result.updated++;
        consecutiveErrors = 0;
      } catch (err) {
        result.failed++;
        consecutiveErrors++;
        result.errors.push(`${unp}: ${(err as Error).message}`);
      }

      // Rate limit: 500ms between requests
      if (i < candidates.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    queryClient.invalidateQueries({ queryKey: ["ai-entities"] });
    setIsBulkRunning(false);
    setBulkProgress(null);

    return result;
  }, [queryClient]);

  return {
    refreshSingle,
    isRefreshing,
    bulkDryRun,
    bulkExecute,
    isBulkRunning,
    bulkProgress,
  };
}
